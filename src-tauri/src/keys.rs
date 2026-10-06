//! Parsing of the key text the user assigns to an action ("F8", "Ctrl+Alt+T") into a virtual-key
//! code plus the exact modifiers. Pure text handling: nothing here touches the keyboard.

/// A key with the modifiers that must be held with it (and no others).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeyCombo {
    pub vk: u32,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

const NEEDS_MODIFIER: &str = "нужен Ctrl или Alt";
const NO_KEY: &str = "не указана клавиша";

const VK_PAUSE: u32 = 0x13;
const VK_PAGE_UP: u32 = 0x21;
const VK_PAGE_DOWN: u32 = 0x22;
const VK_END: u32 = 0x23;
const VK_HOME: u32 = 0x24;
const VK_INSERT: u32 = 0x2D;
const VK_F1: u32 = 0x70;
const VK_SCROLL: u32 = 0x91;
const FUNCTION_KEYS: u32 = 24;

/// A key that may be assigned, and whether it is safe without `Ctrl` / `Alt`.
struct Key {
    vk: u32,
    /// `false` for letters and digits: on their own they would fire while typing.
    works_alone: bool,
}

fn lookup_key(name: &str) -> Option<Key> {
    let named = |vk| {
        Some(Key {
            vk,
            works_alone: true,
        })
    };
    match name.to_ascii_lowercase().as_str() {
        "scrolllock" => return named(VK_SCROLL),
        "pause" => return named(VK_PAUSE),
        "insert" => return named(VK_INSERT),
        "home" => return named(VK_HOME),
        "end" => return named(VK_END),
        "pageup" => return named(VK_PAGE_UP),
        "pagedown" => return named(VK_PAGE_DOWN),
        _ => {}
    }

    // F1..F24, written without a leading zero.
    let digits = name.strip_prefix(['F', 'f']).unwrap_or("");
    if let Ok(n) = digits.parse::<u32>()
        && n.to_string() == digits
        && (1..=FUNCTION_KEYS).contains(&n)
    {
        return named(VK_F1 + n - 1);
    }

    // A single letter or digit: the virtual-key code is the upper-case ASCII code.
    let mut chars = name.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if c.is_ascii_alphanumeric() => Some(Key {
            vk: u32::from(c.to_ascii_uppercase()),
            works_alone: false,
        }),
        _ => None,
    }
}

fn is_modifier_name(text: &str) -> bool {
    matches!(
        text.to_ascii_lowercase().as_str(),
        "ctrl" | "control" | "alt" | "shift"
    )
}

/// Parses `"F8"`, `"ScrollLock"`, `"Ctrl+Alt+T"`, `"Shift+F9"`. Modifiers may come in any order and
/// any case. A letter or a digit needs `Ctrl` and/or `Alt`, otherwise it would fire while typing.
/// The error text is meant for the user.
pub fn parse_key(text: &str) -> Result<KeyCombo, String> {
    let parts: Vec<&str> = text.split('+').map(str::trim).collect();
    let Some((key_text, modifier_texts)) = parts.split_last() else {
        return Err(NO_KEY.to_string());
    };

    let (mut ctrl, mut alt, mut shift) = (false, false, false);
    for modifier in modifier_texts {
        let flag = match modifier.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => &mut ctrl,
            "alt" => &mut alt,
            "shift" => &mut shift,
            "" => return Err(format!("лишний «+» в «{}»", text.trim())),
            _ => return Err(format!("неизвестный модификатор: {modifier}")),
        };
        if *flag {
            return Err(format!("модификатор «{modifier}» указан дважды"));
        }
        *flag = true;
    }

    if key_text.is_empty() || is_modifier_name(key_text) {
        return Err(NO_KEY.to_string());
    }
    let Some(key) = lookup_key(key_text) else {
        return Err(format!("неизвестная клавиша: {key_text}"));
    };
    if !(key.works_alone || ctrl || alt) {
        return Err(NEEDS_MODIFIER.to_string());
    }
    Ok(KeyCombo {
        vk: key.vk,
        ctrl,
        alt,
        shift,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_function_and_named_keys() {
        assert_eq!(
            parse_key("F8").unwrap(),
            KeyCombo {
                vk: 0x77,
                ctrl: false,
                alt: false,
                shift: false
            }
        );
        assert_eq!(parse_key("ScrollLock").unwrap().vk, 0x91);
        assert_eq!(parse_key("Pause").unwrap().vk, 0x13);
    }

    #[test]
    fn parses_modifiers_in_any_order_and_case() {
        let k = parse_key("alt+CTRL+t").unwrap();
        assert_eq!((k.vk, k.ctrl, k.alt, k.shift), (0x54, true, true, false));
        assert!(parse_key("Shift+F9").unwrap().shift);
    }

    #[test]
    fn rejects_bare_letters_unknown_keys_and_garbage() {
        assert!(parse_key("T").is_err());
        assert!(parse_key("5").is_err());
        assert!(parse_key("Ctrl+").is_err());
        assert!(parse_key("Banana").is_err());
        assert!(parse_key("Ctrl+Alt").is_err());
    }

    #[test]
    fn parses_every_allowed_named_key() {
        assert_eq!(parse_key("F1").unwrap().vk, 0x70);
        assert_eq!(parse_key("F24").unwrap().vk, 0x87);
        assert_eq!(parse_key("Insert").unwrap().vk, 0x2D);
        assert_eq!(parse_key("Home").unwrap().vk, 0x24);
        assert_eq!(parse_key("End").unwrap().vk, 0x23);
        assert_eq!(parse_key("PageUp").unwrap().vk, 0x21);
        assert_eq!(parse_key("PageDown").unwrap().vk, 0x22);
    }

    #[test]
    fn letters_and_digits_need_ctrl_or_alt() {
        assert_eq!(parse_key("Ctrl+1").unwrap().vk, 0x31);
        assert_eq!(parse_key("Alt+Z").unwrap().vk, 0x5A);
        assert_eq!(parse_key("Ctrl+0").unwrap().vk, 0x30);
        // Shift alone is not enough: Shift+T is just a capital letter.
        assert_eq!(parse_key("Shift+T"), Err("нужен Ctrl или Alt".to_string()));
        assert_eq!(parse_key("T"), Err("нужен Ctrl или Alt".to_string()));
    }

    #[test]
    fn rejects_function_keys_out_of_range() {
        assert!(parse_key("F0").is_err());
        assert!(parse_key("F25").is_err());
        assert!(parse_key("F").is_err());
        assert!(parse_key("F08").is_err());
    }

    #[test]
    fn rejects_empty_text_and_repeated_modifiers() {
        assert!(parse_key("").is_err());
        assert!(parse_key("   ").is_err());
        assert!(parse_key("Ctrl+Ctrl+F8").is_err());
        assert!(parse_key("+F8").is_err());
    }

    #[test]
    fn tolerates_spaces_around_the_parts() {
        let k = parse_key(" Ctrl + Alt + T ").unwrap();
        assert_eq!((k.vk, k.ctrl, k.alt), (0x54, true, true));
    }
}
