use super::{ParseReservationIdError, ReservationId};

#[test]
fn positive_integers_are_valid_reservation_ids() {
    for value in [1, 42, u64::MAX] {
        let parsed = ReservationId::parse(value).expect("the reservation ID should be valid");
        assert_eq!(ReservationId::of(value), parsed);
    }
}

#[test]
fn non_positive_integers_are_rejected_as_reservation_ids() {
    for value in [0] {
        assert_eq!(
            ReservationId::parse(value),
            Err(ParseReservationIdError::NotPositive)
        );
    }
}

#[test]
fn reservation_id_of_panics_for_non_positive_values() {
    for value in [0] {
        assert!(std::panic::catch_unwind(|| ReservationId::of(value)).is_err());
    }
}
