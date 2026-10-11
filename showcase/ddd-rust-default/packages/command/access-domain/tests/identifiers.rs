use access_domain::access::org_id::{OrgId, ParseOrgIdError};
use access_domain::access::user_id::{ParseUserIdError, UserId};

#[test]
fn identifiers_preserve_empty_and_string_values_and_compare_by_value() {
    for value in ["", "same", "利用者😀"] {
        assert_eq!(UserId::of(value).value(), value);
        assert_eq!(OrgId::of(value).value(), value);
        assert_eq!(UserId::parse(Some(value)), Ok(UserId::of(value)));
        assert_eq!(OrgId::parse(Some(value)), Ok(OrgId::of(value)));
        assert_ne!(UserId::of(value), UserId::of("different"));
        assert_ne!(OrgId::of(value), OrgId::of("different"));
    }
}

#[test]
fn missing_values_are_rejected() {
    assert_eq!(UserId::parse(None), Err(ParseUserIdError::MissingValue));
    assert_eq!(OrgId::parse(None), Err(ParseOrgIdError::MissingValue));
}

#[test]
fn identifiers_own_their_values_after_input_changes() {
    let mut input = String::from("same");
    let user_id = UserId::of(&input);
    let org_id = OrgId::of(&input);
    input.clear();
    assert_eq!(user_id.value(), "same");
    assert_eq!(org_id.value(), "same");
}
