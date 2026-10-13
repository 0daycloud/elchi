//! Decoding on top of the ONNX graphs. A rule-for-rule port of
//! `duyu_small/decode.py`:
//!
//! * CTC greedy: argmax, collapse repeats, drop blanks.
//! * Attention beam search: step 0 forces (or auto-detects) the language
//!   token, step 1 the `<cased>` style, content steps never emit blank / BOS /
//!   control tokens, finished beams absorb `</s>` at zero cost, and the search
//!   is bounded by the CTC greedy length.
//! * Final ranking: length-normalized `(1 - w) * attention + w * CTC` score.
//! * Guards: silence veto and runaway veto (falls back to the CTC text).

pub const NEG: f64 = -1e30;

const MAX_REPEAT_RUN: usize = 6;
const RUNAWAY_RATIO: f64 = 1.5;
const RUNAWAY_SLACK: usize = 10;
const RUNAWAY_SLACK_SHORT: usize = 4;
const RUNAWAY_SHORT: usize = 8;
const N_PREFIX: usize = 3; // <s> <lang> <style>

/// Special token ids from `engine.json`.
#[derive(Clone, Debug)]
pub struct Special {
    pub pad: i64,
    pub bos: i64,
    pub eos: i64,
    pub lang_tr: i64,
    pub lang_en: i64,
    pub lang_mix: i64,
    pub style_cased: i64,
    pub control: Vec<i64>,
}

/// Language prompt for the decoder's first step.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LangPrompt {
    Tr,
    En,
    /// Whatever is spoken, Turkish and English mixed (the model's default).
    Mix,
    /// Let the decoder pick among tr / en / mix.
    Auto,
}

/// Row-major (T, V) CTC log-probabilities.
pub struct CtcLogProbs<'a> {
    pub data: &'a [f32],
    pub frames: usize,
    pub vocab: usize,
}

impl CtcLogProbs<'_> {
    fn at(&self, t: usize, v: usize) -> f64 {
        self.data[t * self.vocab + v] as f64
    }
}

pub fn ctc_greedy_ids(logp: &CtcLogProbs, blank: i64) -> Vec<i64> {
    let mut out = Vec::new();
    let mut prev = -1i64;
    for t in 0..logp.frames {
        let row = &logp.data[t * logp.vocab..(t + 1) * logp.vocab];
        let mut best = 0usize;
        for (v, &x) in row.iter().enumerate() {
            if x > row[best] {
                best = v;
            }
        }
        let id = best as i64;
        if id != prev && id != blank {
            out.push(id);
        }
        prev = id;
    }
    out
}

fn runaway_bound(ctc_len: usize) -> usize {
    let slack = if ctc_len < RUNAWAY_SHORT {
        RUNAWAY_SLACK_SHORT
    } else {
        RUNAWAY_SLACK
    };
    (RUNAWAY_RATIO * ctc_len as f64) as usize + slack
}

fn is_runaway(seq: &[i64], ctc_len: usize) -> bool {
    if seq.len() > runaway_bound(ctc_len) {
        return true;
    }
    for n in 1..=4usize {
        if seq.len() < 2 * n {
            continue;
        }
        let mut run = 1;
        let mut i = n;
        while i + n <= seq.len() {
            if seq[i..i + n] == seq[i - n..i] {
                run += 1;
                if run >= MAX_REPEAT_RUN {
                    return true;
                }
            } else {
                run = 1;
            }
            i += n;
        }
    }
    false
}

fn logaddexp(a: f64, b: f64) -> f64 {
    let m = a.max(b);
    if m <= NEG {
        return m;
    }
    m + ((a - m).exp() + (b - m).exp()).ln()
}

/// -log p_CTC(seq | logp) by the forward algorithm; +inf when unalignable.
pub fn ctc_nll(logp: &CtcLogProbs, seq: &[i64], blank: i64) -> f64 {
    let t_len = logp.frames;
    let b = blank as usize;
    if seq.is_empty() {
        return -(0..t_len).map(|t| logp.at(t, b)).sum::<f64>();
    }
    let mut ext = Vec::with_capacity(2 * seq.len() + 1);
    ext.push(b);
    for &s in seq {
        ext.push(s as usize);
        ext.push(b);
    }
    let s_len = ext.len();
    if t_len < s_len.div_ceil(2) {
        return f64::INFINITY;
    }
    let skip: Vec<bool> = (0..s_len)
        .map(|s| s >= 2 && ext[s] != b && ext[s] != ext[s - 2])
        .collect();
    let mut alpha = vec![NEG; s_len];
    alpha[0] = logp.at(0, b);
    if s_len > 1 {
        alpha[1] = logp.at(0, ext[1]);
    }
    let mut next = vec![NEG; s_len];
    for t in 1..t_len {
        for s in 0..s_len {
            let a0 = alpha[s];
            let a1 = if s >= 1 { alpha[s - 1] } else { NEG };
            let a2 = if skip[s] { alpha[s - 2] } else { NEG };
            let m = a0.max(a1).max(a2);
            next[s] =
                m + ((a0 - m).exp() + (a1 - m).exp() + (a2 - m).exp()).ln() + logp.at(t, ext[s]);
        }
        std::mem::swap(&mut alpha, &mut next);
    }
    let tail = if s_len == 1 {
        alpha[s_len - 1]
    } else {
        logaddexp(alpha[s_len - 1], alpha[s_len - 2])
    };
    if tail > NEG / 2.0 {
        -tail
    } else {
        f64::INFINITY
    }
}

fn log_softmax(row: &[f32]) -> Vec<f64> {
    let m = row.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let sum: f32 = row.iter().map(|&x| (x - m).exp()).sum();
    let lse = sum.ln();
    row.iter().map(|&x| (x - m - lse) as f64).collect()
}

pub struct BeamConfig {
    pub beam: usize,
    pub lang: LangPrompt,
    pub ctc_weight: f64,
    pub max_positions: usize,
}

/// Runs one utterance's beam search. `run_decoder(tokens, k, len)` takes K
/// row-major prefixes of length `len` and returns the logits of each prefix's
/// LAST position, row-major (K, V).
pub fn beam_search(
    sp: &Special,
    ctc: &CtcLogProbs,
    cfg: &BeamConfig,
    mut run_decoder: impl FnMut(&[i64], usize, usize) -> anyhow::Result<Vec<f32>>,
) -> anyhow::Result<Vec<i64>> {
    let v = ctc.vocab;
    let k = cfg.beam.max(1);
    let ctc_seq = ctc_greedy_ids(ctc, sp.pad);
    let mut max_len = (cfg.max_positions - 4).min(8 + ctc.frames / 3);
    if cfg.ctc_weight > 0.0 {
        max_len = max_len.min(runaway_bound(ctc_seq.len()));
    }
    let lang_ids: Vec<i64> = match cfg.lang {
        LangPrompt::Tr => vec![sp.lang_tr],
        LangPrompt::En => vec![sp.lang_en],
        LangPrompt::Mix => vec![sp.lang_mix],
        LangPrompt::Auto => vec![sp.lang_tr, sp.lang_en, sp.lang_mix],
    };

    let mut len = 1usize;
    let mut tokens: Vec<i64> = vec![sp.bos; k];
    let mut scores = vec![NEG; k];
    scores[0] = 0.0;
    let mut finished = vec![false; k];
    let mut cand = vec![0f64; k * v];
    let mut order: Vec<usize> = Vec::with_capacity(k * v);

    for t in 0..(max_len + N_PREFIX - 1) {
        let logits = run_decoder(&tokens, k, len)?;
        for b in 0..k {
            let mut logp = log_softmax(&logits[b * v..(b + 1) * v]);
            if t == 0 {
                let mut keep = vec![NEG; v];
                for &id in &lang_ids {
                    keep[id as usize] = 0.0;
                }
                for (l, kp) in logp.iter_mut().zip(&keep) {
                    *l += kp;
                }
            } else if t == 1 {
                logp.iter_mut().for_each(|l| *l = NEG);
                logp[sp.style_cased as usize] = 0.0;
            } else {
                logp[sp.pad as usize] = NEG;
                logp[sp.bos as usize] = NEG;
                for &c in &sp.control {
                    logp[c as usize] = NEG;
                }
            }
            if finished[b] {
                logp.iter_mut().for_each(|l| *l = NEG);
                logp[sp.eos as usize] = 0.0;
            }
            for (c, l) in cand[b * v..(b + 1) * v].iter_mut().zip(&logp) {
                *c = scores[b] + l;
            }
        }

        order.clear();
        order.extend(0..k * v);
        order.select_nth_unstable_by(k - 1, |&a, &b| cand[b].total_cmp(&cand[a]));
        order.truncate(k);
        order.sort_by(|&a, &b| cand[b].total_cmp(&cand[a]).then(a.cmp(&b)));

        let mut next_tokens = Vec::with_capacity(k * (len + 1));
        let mut next_finished = vec![false; k];
        let mut next_scores = vec![0f64; k];
        for (slot, &idx) in order.iter().enumerate() {
            let (b, tok) = (idx / v, (idx % v) as i64);
            next_tokens.extend_from_slice(&tokens[b * len..(b + 1) * len]);
            next_tokens.push(tok);
            next_finished[slot] = finished[b] || tok == sp.eos;
            next_scores[slot] = cand[idx];
        }
        tokens = next_tokens;
        finished = next_finished;
        scores = next_scores;
        len += 1;
        if t >= N_PREFIX && finished.iter().all(|&f| f) {
            break;
        }
    }

    // Final ranking with CTC rescoring.
    let mut hyps = Vec::with_capacity(k);
    let mut total = vec![0f64; k];
    for b in 0..k {
        let row = &tokens[b * len..(b + 1) * len];
        let mut seq: Vec<i64> = row.get(N_PREFIX..).unwrap_or(&[]).to_vec();
        if let Some(p) = seq.iter().position(|&x| x == sp.eos) {
            seq.truncate(p);
        }
        let mut s = scores[b];
        if cfg.ctc_weight > 0.0 {
            s = (1.0 - cfg.ctc_weight) * s - cfg.ctc_weight * ctc_nll(ctc, &seq, sp.pad);
        }
        let l = (seq.len() + 1) as f64;
        total[b] = if s.is_finite() {
            s / l
        } else {
            f64::NEG_INFINITY
        };
        hyps.push(seq);
    }
    let mut ranked: Vec<usize> = (0..k).collect();
    ranked.sort_by(|&a, &b| total[b].total_cmp(&total[a]).then(a.cmp(&b)));

    if cfg.ctc_weight > 0.0 {
        if ctc_seq.len() <= 1 && hyps[ranked[0]].len() > ctc_seq.len() + 1 {
            return Ok(Vec::new()); // silence veto
        }
        for &j in &ranked {
            if total[j].is_finite() && !is_runaway(&hyps[j], ctc_seq.len()) {
                return Ok(hyps[j].clone());
            }
        }
        return Ok(ctc_seq); // every beam loops: the CTC text
    }
    Ok(hyps[ranked[0]].clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greedy_collapses_repeats_and_blanks() {
        // frames argmax: 0 3 3 0 3 5
        let v = 6;
        let argmax = [0usize, 3, 3, 0, 3, 5];
        let mut data = vec![-10f32; argmax.len() * v];
        for (t, &a) in argmax.iter().enumerate() {
            data[t * v + a] = 0.0;
        }
        let lp = CtcLogProbs {
            data: &data,
            frames: argmax.len(),
            vocab: v,
        };
        assert_eq!(ctc_greedy_ids(&lp, 0), vec![3, 3, 5]);
    }

    #[test]
    fn ctc_nll_rejects_unalignable() {
        let data = vec![(0.5f32).ln(); 2 * 2];
        let lp = CtcLogProbs {
            data: &data,
            frames: 2,
            vocab: 2,
        };
        assert!(ctc_nll(&lp, &[1, 1, 1], 0).is_infinite());
        assert!(ctc_nll(&lp, &[1], 0).is_finite());
    }

    #[test]
    fn runaway_detects_repeats() {
        assert!(is_runaway(&[7; 12], 20));
        assert!(!is_runaway(&[1, 2, 3, 4, 5], 5));
        assert!(is_runaway(&[1; 30], 2));
    }
}
