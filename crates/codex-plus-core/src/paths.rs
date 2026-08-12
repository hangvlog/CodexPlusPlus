use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const APP_STATE_DIR: &str = ".codex-session-delete";
const APP_STATE_DIR_OVERRIDE_ENV: &str = "CODEX_PLUS_STATE_DIR";
const SETTINGS_FILE: &str = "settings.json";
const LATEST_STATUS_FILE: &str = "latest-status.json";
const DIAGNOSTIC_LOG_FILE: &str = "codex-plus.log";
const PENDING_PROVIDER_IMPORT_FILE: &str = "pending-provider-import.json";

pub fn default_app_state_dir() -> PathBuf {
    if let Some(override_dir) = app_state_dir_override(std::env::var_os(APP_STATE_DIR_OVERRIDE_ENV))
    {
        return override_dir;
    }
    if let Some(home_dir) = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf()) {
        return home_dir.join(APP_STATE_DIR);
    }

    PathBuf::from(APP_STATE_DIR)
}

fn app_state_dir_override(value: Option<std::ffi::OsString>) -> Option<PathBuf> {
    value.filter(|value| !value.is_empty()).map(PathBuf::from)
}

pub fn default_settings_path() -> PathBuf {
    if let Some(path) = settings_path_for_tests() {
        return path;
    }
    default_app_state_dir().join(SETTINGS_FILE)
}

pub fn default_latest_status_path() -> PathBuf {
    default_app_state_dir().join(LATEST_STATUS_FILE)
}

pub fn default_diagnostic_log_path() -> PathBuf {
    default_app_state_dir().join(DIAGNOSTIC_LOG_FILE)
}

pub fn default_pending_provider_import_path() -> PathBuf {
    default_app_state_dir().join(PENDING_PROVIDER_IMPORT_FILE)
}

fn settings_path_for_tests() -> Option<PathBuf> {
    SETTINGS_PATH_FOR_TESTS
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()
        .and_then(|path| path.clone())
}

static SETTINGS_PATH_FOR_TESTS: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

#[cfg(test)]
static SETTINGS_PATH_TEST_GUARD: OnceLock<Mutex<()>> = OnceLock::new();

#[cfg(test)]
pub(crate) fn settings_path_test_guard() -> std::sync::MutexGuard<'static, ()> {
    SETTINGS_PATH_TEST_GUARD
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap()
}

pub fn set_settings_path_for_tests(path: Option<PathBuf>) -> Option<PathBuf> {
    SETTINGS_PATH_FOR_TESTS
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()
        .and_then(|mut current| std::mem::replace(&mut *current, path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_path_uses_app_state_directory() {
        let _guard = settings_path_test_guard();
        let path = default_settings_path();

        assert!(path.ends_with(".codex-session-delete/settings.json"));
    }

    #[test]
    fn default_latest_status_path_uses_app_state_directory() {
        let path = default_latest_status_path();

        assert!(path.ends_with(".codex-session-delete/latest-status.json"));
    }

    #[test]
    fn default_diagnostic_log_path_uses_app_state_directory() {
        let path = default_diagnostic_log_path();

        assert!(path.ends_with(".codex-session-delete/codex-plus.log"));
    }

    #[test]
    fn default_pending_provider_import_path_uses_app_state_directory() {
        let path = default_pending_provider_import_path();

        assert!(path.ends_with(".codex-session-delete/pending-provider-import.json"));
    }

    #[test]
    fn explicit_state_directory_override_is_normalized() {
        assert_eq!(
            app_state_dir_override(Some("/tmp/codex-plus-isolated-state".into())),
            Some(PathBuf::from("/tmp/codex-plus-isolated-state"))
        );
        assert_eq!(app_state_dir_override(Some("".into())), None);
        assert_eq!(app_state_dir_override(None), None);
    }
}
