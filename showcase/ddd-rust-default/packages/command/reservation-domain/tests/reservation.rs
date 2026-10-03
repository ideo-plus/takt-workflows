use reservation_domain::{
    CreateReservationError, MemberId, Reservation, ReservationConfirmationError, ReservationError,
    ReservationId, ReservationStatus, RoomId, TimeSlot, TimeSlotError,
};

fn confirmed_reservation(reservation_id: u64) -> Reservation {
    let mut reservation = Reservation::create(
        ReservationId::of(reservation_id),
        MemberId::of(101),
        RoomId::of(201),
        1_700_000_000,
        1_700_003_600,
    )
    .expect("the fixture end must be after its start");
    reservation
        .reserve_room()
        .expect("the fixture can be confirmed");
    reservation
}

#[test]
fn reservation_starts_confirmed_with_member_room_and_time_slot() {
    let reservation_id = ReservationId::of(1);
    let member_id = MemberId::of(101);
    let room_id = RoomId::of(201);
    let time_slot =
        TimeSlot::new(1_700_000_000, 1_700_003_600).expect("the end is after the start");

    let mut reservation = Reservation::create(
        reservation_id.clone(),
        member_id.clone(),
        room_id.clone(),
        time_slot.start(),
        time_slot.end(),
    )
    .expect("the end is after the start");

    assert_eq!(reservation.status(), ReservationStatus::Uncreated);
    assert_eq!(reservation.id(), &reservation_id);
    assert_eq!(reservation.member_id(), &member_id);
    assert_eq!(reservation.room_id(), &room_id);
    assert_eq!(reservation.time_slot(), &time_slot);

    let confirmed: reservation_domain::ReservationConfirmed = reservation
        .reserve_room()
        .expect("the prepared reservation can be confirmed");

    assert_eq!(reservation.id(), &reservation_id);
    assert_eq!(reservation.member_id(), &member_id);
    assert_eq!(reservation.room_id(), &room_id);
    assert_eq!(reservation.time_slot(), &time_slot);
    assert!(reservation.is_confirmed());
    assert_eq!(confirmed.reservation_id(), &reservation_id);
}

#[test]
fn time_slot_accepts_an_end_after_its_start() {
    let time_slot = TimeSlot::new(100, 101).expect("the end is one second after the start");

    assert_eq!((time_slot.start(), time_slot.end()), (100, 101));
}

#[test]
fn time_slot_rejects_an_end_equal_to_its_start() {
    let result = TimeSlot::new(100, 100);

    assert!(matches!(result, Err(TimeSlotError::EndNotAfterStart)));
}

#[test]
fn time_slot_rejects_an_end_before_its_start() {
    let result = TimeSlot::new(100, 99);

    assert!(matches!(result, Err(TimeSlotError::EndNotAfterStart)));
}

#[test]
fn reservation_rejects_an_end_equal_to_its_start() {
    let result = Reservation::create(
        ReservationId::of(1),
        MemberId::of(101),
        RoomId::of(201),
        100,
        100,
    );
    assert!(matches!(
        result,
        Err(CreateReservationError::EndNotAfterStart)
    ));
}

#[test]
fn reservation_rejects_an_end_before_its_start() {
    let result = Reservation::create(
        ReservationId::of(1),
        MemberId::of(101),
        RoomId::of(201),
        100,
        99,
    );
    assert!(matches!(
        result,
        Err(CreateReservationError::EndNotAfterStart)
    ));
}

#[test]
fn confirmed_reservation_can_be_cancelled_only_once() {
    let mut reservation = confirmed_reservation(1);

    assert!(reservation.is_confirmed());

    let cancelled = reservation
        .cancel()
        .expect("a confirmed reservation can be cancelled");

    assert_eq!(cancelled.reservation_id(), reservation.id());
    assert!(reservation.is_cancelled());

    let second_cancellation = reservation.cancel();

    assert!(matches!(
        second_cancellation,
        Err(ReservationError::AlreadyCancelled)
    ));
    assert!(reservation.is_cancelled());
}

#[test]
fn restore_preserves_all_attributes_of_a_confirmed_reservation() {
    let id = ReservationId::of(7);
    let member_id = MemberId::of(107);
    let room_id = RoomId::of(207);
    let time_slot = TimeSlot::new(100, 200).expect("valid time slot");

    let mut reservation = Reservation::restore(
        id.clone(),
        member_id.clone(),
        room_id.clone(),
        time_slot.clone(),
        ReservationStatus::Confirmed,
    );

    assert_eq!(reservation.id(), &id);
    assert_eq!(reservation.member_id(), &member_id);
    assert_eq!(reservation.room_id(), &room_id);
    assert_eq!(reservation.time_slot(), &time_slot);
    assert_eq!(reservation.status(), ReservationStatus::Confirmed);
    assert!(reservation.is_confirmed());
    assert!(!reservation.is_cancelled());
    assert!(reservation.cancel().is_ok());
    assert_eq!(reservation.status(), ReservationStatus::Cancelled);
}

#[test]
fn restore_preserves_a_cancelled_reservation_without_reconfirming_it() {
    let id = ReservationId::of(7);
    let member_id = MemberId::of(107);
    let room_id = RoomId::of(207);
    let time_slot = TimeSlot::new(100, 200).expect("valid time slot");

    let mut reservation = Reservation::restore(
        id.clone(),
        member_id.clone(),
        room_id.clone(),
        time_slot.clone(),
        ReservationStatus::Cancelled,
    );

    assert_eq!(reservation.id(), &id);
    assert_eq!(reservation.member_id(), &member_id);
    assert_eq!(reservation.room_id(), &room_id);
    assert_eq!(reservation.time_slot(), &time_slot);
    assert_eq!(reservation.status(), ReservationStatus::Cancelled);
    assert!(!reservation.is_confirmed());
    assert!(reservation.is_cancelled());
    assert_eq!(
        reservation.cancel(),
        Err(ReservationError::AlreadyCancelled)
    );
    assert_eq!(reservation.status(), ReservationStatus::Cancelled);
}

#[test]
fn confirming_a_confirmed_reservation_fails_without_changing_its_state() {
    let mut reservation = confirmed_reservation(1);
    let result = reservation.reserve_room();
    assert!(matches!(
        result,
        Err(ReservationConfirmationError::AlreadyConfirmed)
    ));
    assert_eq!(reservation.status(), ReservationStatus::Confirmed);
}

#[test]
fn restore_preserves_an_uncreated_reservation_before_confirmation() {
    let mut reservation = Reservation::restore(
        ReservationId::of(7),
        MemberId::of(107),
        RoomId::of(207),
        TimeSlot::new(100, 200).expect("valid time slot"),
        ReservationStatus::Uncreated,
    );
    assert_eq!(reservation.id(), &ReservationId::of(7));
    assert_eq!(reservation.member_id(), &MemberId::of(107));
    assert_eq!(reservation.room_id(), &RoomId::of(207));
    assert_eq!(reservation.time_slot().start(), 100);
    assert_eq!(reservation.time_slot().end(), 200);
    assert_eq!(reservation.status(), ReservationStatus::Uncreated);
    let confirmed = reservation
        .reserve_room()
        .expect("restored preparation can be confirmed");
    assert_eq!(confirmed.reservation_id(), &ReservationId::of(7));
    assert_eq!(reservation.status(), ReservationStatus::Confirmed);
}

#[test]
fn restore_preserves_each_attribute_when_only_one_input_changes() {
    for (id, member, room, start, end) in [
        (7, 107, 207, 100, 200),
        (8, 107, 207, 100, 200),
        (7, 108, 207, 100, 200),
        (7, 107, 208, 100, 200),
        (7, 107, 207, 101, 200),
        (7, 107, 207, 100, 201),
    ] {
        let reservation = Reservation::restore(
            ReservationId::of(id),
            MemberId::of(member),
            RoomId::of(room),
            TimeSlot::new(start, end).expect("valid time slot"),
            ReservationStatus::Confirmed,
        );
        assert_eq!(reservation.id(), &ReservationId::of(id));
        assert_eq!(reservation.member_id(), &MemberId::of(member));
        assert_eq!(reservation.room_id(), &RoomId::of(room));
        assert_eq!(reservation.time_slot().start(), start);
        assert_eq!(reservation.time_slot().end(), end);
        assert_eq!(reservation.status(), ReservationStatus::Confirmed);
    }
}

#[test]
fn create_preserves_a_one_second_time_slot() {
    let reservation = Reservation::create(
        ReservationId::of(7),
        MemberId::of(107),
        RoomId::of(207),
        100,
        101,
    )
    .expect("end is after start");
    assert_eq!(reservation.time_slot().start(), 100);
    assert_eq!(reservation.time_slot().end(), 101);
}

#[test]
fn confirming_a_cancelled_reservation_fails_without_changing_its_state() {
    let mut reservation = confirmed_reservation(1);
    reservation
        .cancel()
        .expect("confirmed reservation can be cancelled");
    let result = reservation.reserve_room();
    assert!(matches!(
        result,
        Err(ReservationConfirmationError::AlreadyCancelled)
    ));
    assert_eq!(reservation.status(), ReservationStatus::Cancelled);
}

#[test]
fn cancelling_an_uncreated_reservation_fails_without_changing_its_state() {
    let mut reservation = Reservation::create(
        ReservationId::of(1),
        MemberId::of(101),
        RoomId::of(201),
        100,
        200,
    )
    .expect("valid time slot");
    assert_eq!(reservation.cancel(), Err(ReservationError::NotConfirmed));
    assert_eq!(reservation.status(), ReservationStatus::Uncreated);
    reservation
        .reserve_room()
        .expect("rejected cancellation must not prevent confirmation");
    assert_eq!(reservation.status(), ReservationStatus::Confirmed);
}
