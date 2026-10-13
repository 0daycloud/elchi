//! Log-mel fbank exactly as Duyu-small was trained on (w2v-BERT 2.0 front
//! end): Kaldi framing 25 ms / 10 ms, DC removal, pre-emphasis 0.97, Povey
//! window, 512-point power spectrum, 80 mel bins, log, per-utterance
//! mean/variance normalization, two frames stacked -> 160-dim vectors.
//! Port of `duyu_small/features.py`; the window and mel filters come from
//! the model's `fbank.npz`.

use std::sync::Arc;

use rustfft::{num_complex::Complex, Fft, FftPlanner};

pub const WIN: usize = 400;
pub const HOP: usize = 160;
pub const NFFT: usize = 512;
pub const MELS: usize = 80;
pub const FEAT_DIM: usize = 2 * MELS;
const BINS: usize = NFFT / 2 + 1;
const EPS: f64 = 1.192092955078125e-07;

pub struct Fbank {
    window: Vec<f64>, // (400,)
    mel: Vec<f64>,    // (257, 80) row-major
    fft: Arc<dyn Fft<f64>>,
}

impl Fbank {
    pub fn new(window: &[f32], mel: &[f32]) -> anyhow::Result<Self> {
        anyhow::ensure!(
            window.len() == WIN,
            "fbank window has {} taps, expected {WIN}",
            window.len()
        );
        anyhow::ensure!(
            mel.len() == BINS * MELS,
            "fbank mel table has {} values, expected {}",
            mel.len(),
            BINS * MELS
        );
        Ok(Self {
            window: window.iter().map(|&v| v as f64).collect(),
            mel: mel.iter().map(|&v| v as f64).collect(),
            fft: FftPlanner::new().plan_fft_forward(NFFT),
        })
    }

    /// 16 kHz mono samples in [-1, 1] -> (frames, 160) features, row-major.
    pub fn compute(&self, wav: &[f32]) -> (Vec<f32>, usize) {
        let mut x: Vec<f64> = wav.iter().map(|&s| s as f64 * 32768.0).collect();
        if x.len() < WIN {
            x.resize(WIN, 0.0);
        }
        let n = (x.len() - WIN) / HOP + 1;

        let mut logmel = vec![0f64; n * MELS];
        let mut buf = vec![Complex::new(0f64, 0f64); NFFT];
        let mut frame = [0f64; WIN];
        let mut power = [0f64; BINS];
        for f in 0..n {
            let src = &x[f * HOP..f * HOP + WIN];
            let mean = src.iter().sum::<f64>() / WIN as f64;
            for (d, s) in frame.iter_mut().zip(src) {
                *d = s - mean;
            }
            buf[0] = Complex::new(frame[0] * (1.0 - 0.97) * self.window[0], 0.0);
            for i in 1..WIN {
                buf[i] = Complex::new((frame[i] - 0.97 * frame[i - 1]) * self.window[i], 0.0);
            }
            for c in buf[WIN..].iter_mut() {
                *c = Complex::new(0.0, 0.0);
            }
            self.fft.process(&mut buf);
            for (p, c) in power.iter_mut().zip(&buf[..BINS]) {
                *p = c.norm_sqr();
            }
            let row = &mut logmel[f * MELS..(f + 1) * MELS];
            for (b, &p) in power.iter().enumerate() {
                if p == 0.0 {
                    continue;
                }
                let filt = &self.mel[b * MELS..(b + 1) * MELS];
                for (r, w) in row.iter_mut().zip(filt) {
                    *r += p * w;
                }
            }
            for r in row.iter_mut() {
                *r = r.max(EPS).ln();
            }
        }

        // Per-utterance normalization, ddof=1 variance (1 for a single frame).
        for m in 0..MELS {
            let mean = (0..n).map(|f| logmel[f * MELS + m]).sum::<f64>() / n as f64;
            let var = if n > 1 {
                (0..n)
                    .map(|f| (logmel[f * MELS + m] - mean).powi(2))
                    .sum::<f64>()
                    / (n - 1) as f64
            } else {
                1.0
            };
            let scale = 1.0 / (var + 1e-7).sqrt();
            for f in 0..n {
                let v = &mut logmel[f * MELS + m];
                *v = (*v - mean) * scale;
            }
        }

        // Stack frame pairs: (t, 80) -> (t / 2, 160), dropping an odd tail frame.
        let t = n - n % 2;
        let feats = logmel[..t * MELS].iter().map(|&v| v as f32).collect();
        (feats, t / 2)
    }
}
