//! Decode-only SentencePiece: reads the piece table out of `spm.model` (a
//! `ModelProto` protobuf) and turns ids back into text, so the engine needs
//! no C++ sentencepiece build.

use std::path::Path;

use anyhow::{bail, Context, Result};

#[derive(Clone, Copy, PartialEq, Eq)]
enum PieceType {
    Normal,
    Unknown,
    Control,
    UserDefined,
    Byte,
    Unused,
}

pub struct Tokenizer {
    pieces: Vec<(String, PieceType)>,
}

impl Tokenizer {
    pub fn load(path: &Path) -> Result<Self> {
        let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
        let mut pieces = Vec::new();
        let mut r = Reader::new(&bytes);
        while !r.done() {
            let (field, wire) = r.key()?;
            if field == 1 && wire == 2 {
                pieces.push(parse_piece(r.bytes()?)?);
            } else {
                r.skip(wire)?;
            }
        }
        if pieces.is_empty() {
            bail!("{} has no pieces", path.display());
        }
        Ok(Self { pieces })
    }

    pub fn decode(&self, ids: &[i64]) -> String {
        let mut bytes: Vec<u8> = Vec::new();
        for &id in ids {
            let Some((piece, kind)) = self.pieces.get(id as usize) else {
                continue;
            };
            match kind {
                PieceType::Control | PieceType::Unused => {}
                PieceType::Unknown => bytes.extend_from_slice(" \u{2047} ".as_bytes()),
                PieceType::Byte => {
                    let hex = piece.trim_start_matches("<0x").trim_end_matches('>');
                    if let Ok(b) = u8::from_str_radix(hex, 16) {
                        bytes.push(b);
                    }
                }
                PieceType::Normal | PieceType::UserDefined => {
                    bytes.extend_from_slice(piece.replace('\u{2581}', " ").as_bytes())
                }
            }
        }
        String::from_utf8_lossy(&bytes).trim().to_string()
    }
}

fn parse_piece(buf: &[u8]) -> Result<(String, PieceType)> {
    let mut piece = String::new();
    let mut kind = PieceType::Normal;
    let mut r = Reader::new(buf);
    while !r.done() {
        let (field, wire) = r.key()?;
        match (field, wire) {
            (1, 2) => piece = String::from_utf8_lossy(r.bytes()?).into_owned(),
            (3, 0) => {
                kind = match r.varint()? {
                    2 => PieceType::Unknown,
                    3 => PieceType::Control,
                    4 => PieceType::UserDefined,
                    5 => PieceType::Unused,
                    6 => PieceType::Byte,
                    _ => PieceType::Normal,
                }
            }
            _ => r.skip(wire)?,
        }
    }
    Ok((piece, kind))
}

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }
    fn done(&self) -> bool {
        self.pos >= self.buf.len()
    }
    fn varint(&mut self) -> Result<u64> {
        let mut v = 0u64;
        for shift in (0..64).step_by(7) {
            let Some(&b) = self.buf.get(self.pos) else {
                bail!("truncated varint");
            };
            self.pos += 1;
            v |= ((b & 0x7f) as u64) << shift;
            if b & 0x80 == 0 {
                return Ok(v);
            }
        }
        bail!("varint too long")
    }
    fn key(&mut self) -> Result<(u64, u8)> {
        let k = self.varint()?;
        Ok((k >> 3, (k & 7) as u8))
    }
    fn bytes(&mut self) -> Result<&'a [u8]> {
        let len = self.varint()? as usize;
        let end = self.pos + len;
        if end > self.buf.len() {
            bail!("truncated field");
        }
        let out = &self.buf[self.pos..end];
        self.pos = end;
        Ok(out)
    }
    fn skip(&mut self, wire: u8) -> Result<()> {
        match wire {
            0 => {
                self.varint()?;
            }
            1 => self.pos += 8,
            2 => {
                self.bytes()?;
            }
            5 => self.pos += 4,
            w => bail!("unsupported protobuf wire type {w}"),
        }
        Ok(())
    }
}
