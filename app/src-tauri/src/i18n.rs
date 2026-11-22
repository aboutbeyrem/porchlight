//! Languages. Every sentence Porchlight says is written in English, French and Arabic side by side (see `tx!`),
//! and this picks one: the language chosen in Settings, or Windows' own display language.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Lang {
    #[default]
    En,
    Fr,
    Ar,
}

impl Lang {
    /// "en", "fr", "ar", or nothing (follow Windows).
    pub fn from_setting(setting: Option<&str>) -> Lang {
        match setting {
            Some("en") => Lang::En,
            Some("fr") => Lang::Fr,
            Some("ar") => Lang::Ar,
            _ => system(),
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::Fr => "fr",
            Lang::Ar => "ar",
        }
    }
}

#[cfg(not(test))]
#[link(name = "kernel32")]
extern "system" {
    fn GetUserDefaultUILanguage() -> u16;
}

/// Windows' display language (primary language ID: 0x0C French, 0x01 Arabic).
#[cfg(not(test))]
pub fn system() -> Lang {
    // SAFETY: takes no arguments and only reads the user's language setting.
    let id = unsafe { GetUserDefaultUILanguage() } & 0x3ff;
    match id {
        0x0c => Lang::Fr,
        0x01 => Lang::Ar,
        _ => Lang::En,
    }
}

/// Tests always run in English, whatever the computer's language.
#[cfg(test)]
pub fn system() -> Lang {
    Lang::En
}

/// One sentence in three languages; only the chosen one is built.
#[macro_export]
macro_rules! tx {
    ($lang:expr, $en:expr, $fr:expr, $ar:expr $(,)?) => {
        match $lang {
            $crate::i18n::Lang::Fr => String::from($fr),
            $crate::i18n::Lang::Ar => String::from($ar),
            $crate::i18n::Lang::En => String::from($en),
        }
    };
}

#[cfg(test)]
mod tests {
    use super::Lang;

    #[test]
    fn a_chosen_language_wins_over_windows() {
        assert_eq!(Lang::from_setting(Some("ar")), Lang::Ar);
        assert_eq!(Lang::from_setting(Some("fr")), Lang::Fr);
        assert_eq!(Lang::from_setting(None), Lang::En);
    }

    #[test]
    fn only_the_chosen_sentence_is_used() {
        assert_eq!(tx!(Lang::Fr, "door", "porte", "باب"), "porte");
    }
}
