use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::{
    CancelReservationError, CorruptReservationHistory, Reservation, ReservationCancelled,
    ReservationEvent, ReservationStatus, ReserveReservationError,
};
use crate::member_id::MemberId;
use crate::reservation::reservation_id::ReservationId;
use crate::reservation::time_slot::TimeSlot;
use crate::room_id::RoomId;

fn valid_times() -> (SystemTime, SystemTime) {
    let start = UNIX_EPOCH + Duration::from_secs(3_600);
    let end = start + Duration::from_secs(1_800);
    (start, end)
}

#[test]
fn reservation_keeps_its_member_room_and_time_slot() {
    let reservation_id = ReservationId::of(1);
    let member_id = MemberId::of(2);
    let room_id = RoomId::of(3);
    let (start, end) = valid_times();
    let expected_time_slot = TimeSlot::create(start, end).expect("the time slot should be valid");

    let reservation = Reservation::reserve(
        reservation_id.clone(),
        member_id.clone(),
        room_id.clone(),
        start,
        end,
    )
    .expect("the reservation should be valid");

    assert_eq!(reservation.id(), &reservation_id);
    assert_eq!(reservation.member_id(), &member_id);
    assert_eq!(reservation.room_id(), &room_id);
    assert_eq!(reservation.time_slot(), &expected_time_slot);
    assert_eq!(reservation.status(), ReservationStatus::Confirmed);
}

#[test]
fn reservation_rejects_an_invalid_time_slot() {
    let start = UNIX_EPOCH + Duration::from_secs(3_600);

    let result = Reservation::reserve(
        ReservationId::of(1),
        MemberId::of(2),
        RoomId::of(3),
        start,
        start,
    );

    assert!(matches!(
        result,
        Err(ReserveReservationError::InvalidTimeSlot)
    ));
}

#[test]
fn confirmed_reservation_can_be_cancelled_only_once() {
    let reservation_id = ReservationId::of(1);
    let (start, end) = valid_times();
    let mut reservation = Reservation::reserve(
        reservation_id.clone(),
        MemberId::of(2),
        RoomId::of(3),
        start,
        end,
    )
    .expect("the reservation should be valid");

    let event = reservation
        .cancel()
        .expect("a confirmed reservation should be cancellable");

    assert_eq!(event.reservation_id(), &reservation_id);
    assert_eq!(reservation.status(), ReservationStatus::Cancelled);
    assert_eq!(
        reservation.cancel(),
        Err(CancelReservationError::AlreadyCancelled)
    );
    assert_eq!(reservation.status(), ReservationStatus::Cancelled);
}

#[test]
fn sequence_numbers_start_at_the_reservation_and_advance_with_the_cancellation() {
    let (start, end) = valid_times();
    let mut reservation = Reservation::reserve(
        ReservationId::of(1),
        MemberId::of(2),
        RoomId::of(3),
        start,
        end,
    )
    .unwrap();
    let birth = ReservationEvent::Reserved(reservation.reserved_event());
    assert_eq!(reservation.sequence_number(), 1);
    assert_eq!(birth.sequence_number(), 1);

    let cancellation = ReservationEvent::Cancelled(reservation.cancel().unwrap());

    assert_eq!(cancellation.sequence_number(), 2);
    assert_eq!(reservation.sequence_number(), 2);
}

#[test]
fn replay_applies_the_events_after_the_snapshot() {
    let (start, end) = valid_times();
    let snapshot = Reservation::reserve(
        ReservationId::of(1),
        MemberId::of(2),
        RoomId::of(3),
        start,
        end,
    )
    .unwrap();
    let mut cancelled = snapshot.clone();
    let cancellation = ReservationEvent::Cancelled(cancelled.cancel().unwrap());

    assert_eq!(
        Reservation::replay(&[], snapshot.clone()).unwrap(),
        snapshot
    );
    assert_eq!(
        Reservation::replay(&[cancellation], snapshot).unwrap(),
        cancelled
    );
}

#[test]
fn replay_rejects_events_that_do_not_continue_the_snapshot() {
    let (start, end) = valid_times();
    let snapshot = Reservation::reserve(
        ReservationId::of(1),
        MemberId::of(2),
        RoomId::of(3),
        start,
        end,
    )
    .unwrap();
    let birth = ReservationEvent::Reserved(snapshot.reserved_event());
    let mut cancelled = snapshot.clone();
    let cancellation = ReservationEvent::Cancelled(cancelled.cancel().unwrap());
    let mut other = Reservation::reserve(
        ReservationId::of(2),
        MemberId::of(2),
        RoomId::of(3),
        start,
        end,
    )
    .unwrap();
    let other_cancellation = ReservationEvent::Cancelled(other.cancel().unwrap());

    assert_eq!(
        Reservation::replay(&[birth.clone()], snapshot.clone()),
        Err(CorruptReservationHistory::OutOfSequence)
    );
    assert_eq!(
        Reservation::replay(&[cancellation.clone()], cancelled.clone()),
        Err(CorruptReservationHistory::OutOfSequence)
    );
    assert_eq!(
        Reservation::replay(&[cancellation.clone(), cancellation], snapshot.clone()),
        Err(CorruptReservationHistory::OutOfSequence)
    );
    assert_eq!(
        Reservation::replay(&[other_cancellation], snapshot),
        Err(CorruptReservationHistory::WrongReservation)
    );
    assert_eq!(
        Reservation::replay(
            &[ReservationEvent::Cancelled(ReservationCancelled::new(
                ReservationId::of(1),
                3
            ))],
            cancelled.clone()
        ),
        Err(CorruptReservationHistory::InvalidTransition)
    );
    assert_eq!(
        Reservation::replay(&[], cancelled.clone()).unwrap(),
        cancelled
    );
}
