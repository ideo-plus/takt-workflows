use super::{MemberId, ParseMemberIdError};

#[test]
fn positive_integers_are_valid_member_ids() {
    for value in [1, 42, u64::MAX] {
        let parsed = MemberId::parse(value).expect("the member ID should be valid");
        assert_eq!(MemberId::of(value), parsed);
    }
}

#[test]
fn non_positive_integers_are_rejected_as_member_ids() {
    for value in [0] {
        assert_eq!(MemberId::parse(value), Err(ParseMemberIdError::NotPositive));
    }
}

#[test]
fn member_id_of_panics_for_non_positive_values() {
    for value in [0] {
        assert!(std::panic::catch_unwind(|| MemberId::of(value)).is_err());
    }
}
