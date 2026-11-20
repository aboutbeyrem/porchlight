//! A small, private log file (porchlight.log in the app's data folder) so problems on someone's computer can be
//! understood. It never contains Wi-Fi passwords (Porchlight never has them) and stays on this computer.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

static PATH: OnceLock<PathBuf> = OnceLock::new();
static LOCK: Mutex<()> = Mutex::new(());
const MAX_BYTES: u64 = 512 * 1024;

pub fn init(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    let _ = PATH.set(dir.join("porchlight.log"));
}

/// UTC timestamp like 2026-11-20T17:43:05Z, without pulling in a date library.
pub fn timestamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

pub fn write(level: &str, msg: &str) {
    let Some(path) = PATH.get() else { return };
    let Ok(_guard) = LOCK.lock() else { return };
    if std::fs::metadata(path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = std::fs::rename(path, path.with_extension("old.log"));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{} [{level}] {msg}", timestamp(crate::guard::now()));
    }
}

/// The last lines of the log, for the diagnostic report.
pub fn tail(lines: usize) -> Vec<String> {
    let Some(path) = PATH.get() else { return Vec::new() };
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].iter().map(|s| s.to_string()).collect()
}

#[macro_export]
macro_rules! log_info { ($($t:tt)*) => { $crate::log::write("info", &format!($($t)*)) }; }
#[macro_export]
macro_rules! log_warn { ($($t:tt)*) => { $crate::log::write("warn", &format!($($t)*)) }; }

#[cfg(test)]
mod tests {
    #[test]
    fn timestamps_are_utc_iso() {
        assert_eq!(super::timestamp(0), "1970-01-01T00:00:00Z");
        assert_eq!(super::timestamp(1_795_196_585), "2026-11-20T17:43:05Z");
    }
}
