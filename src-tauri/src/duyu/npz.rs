//! Minimal reader for the little-endian float32 arrays in Duyu-small's
//! `.npz` tables (`np.savez`: an uncompressed zip of `.npy` files).

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use anyhow::{anyhow, bail, Context, Result};

pub struct NpyArray {
    pub shape: Vec<usize>,
    pub data: Vec<f32>,
}

pub fn load_f32(path: &Path) -> Result<HashMap<String, NpyArray>> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut zip = zip::ZipArchive::new(file).with_context(|| format!("read {}", path.display()))?;
    let mut out = HashMap::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name().trim_end_matches(".npy").to_string();
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes)?;
        let arr = parse_npy(&bytes).with_context(|| format!("{}:{}", path.display(), name))?;
        out.insert(name, arr);
    }
    Ok(out)
}

fn parse_npy(bytes: &[u8]) -> Result<NpyArray> {
    if bytes.len() < 10 || &bytes[..6] != b"\x93NUMPY" {
        bail!("not an .npy file");
    }
    let (header_len, start) = match bytes[6] {
        1 => (u16::from_le_bytes([bytes[8], bytes[9]]) as usize, 10),
        2 | 3 => (
            u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize,
            12,
        ),
        v => bail!("unsupported .npy version {v}"),
    };
    let header = std::str::from_utf8(&bytes[start..start + header_len])?;
    if !header.contains("'descr': '<f4'") {
        bail!("expected little-endian float32, header: {header}");
    }
    if header.contains("'fortran_order': True") {
        bail!("fortran-order arrays are not supported");
    }
    let shape_src = header
        .split("'shape': (")
        .nth(1)
        .and_then(|s| s.split(')').next())
        .ok_or_else(|| anyhow!("no shape in header: {header}"))?;
    let shape: Vec<usize> = shape_src
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.parse::<usize>())
        .collect::<std::result::Result<_, _>>()?;
    let count: usize = shape.iter().product();
    let body = &bytes[start + header_len..];
    if body.len() < count * 4 {
        bail!("truncated array: {} bytes for {count} floats", body.len());
    }
    let data = body[..count * 4]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|c| f32::from_le_bytes(*c))
        .collect();
    Ok(NpyArray { shape, data })
}
