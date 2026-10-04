use super::{ParseRoomIdError, RoomId};

#[test]
fn positive_integers_are_valid_room_ids() {
    for value in [1, 42, u64::MAX] {
        let parsed = RoomId::parse(value).expect("the room ID should be valid");
        assert_eq!(RoomId::of(value), parsed);
    }
}

#[test]
fn non_positive_integers_are_rejected_as_room_ids() {
    for value in [0] {
        assert_eq!(RoomId::parse(value), Err(ParseRoomIdError::NotPositive));
    }
}

#[test]
fn room_id_of_panics_for_non_positive_values() {
    for value in [0] {
        assert!(std::panic::catch_unwind(|| RoomId::of(value)).is_err());
    }
}
