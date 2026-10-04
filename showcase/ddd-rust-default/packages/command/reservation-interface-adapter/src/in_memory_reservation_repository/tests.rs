use super::*;
use reservation_domain::member_id::MemberId;
use reservation_domain::reservation::ReservationStatus;
use reservation_domain::room_id::RoomId;
use std::time::{Duration, UNIX_EPOCH};

fn reservation(id: u64) -> Reservation {
    Reservation::reserve(
        ReservationId::of(id),
        MemberId::of(2),
        RoomId::of(3),
        UNIX_EPOCH,
        UNIX_EPOCH + Duration::from_secs(60),
    )
    .unwrap()
}

fn store_new(repository: &mut InMemoryReservationRepository, reservation: &Reservation) {
    repository
        .store(
            reservation.id(),
            ReservationEvent::Reserved(reservation.reserved_event()),
        )
        .unwrap();
}

#[test]
fn storing_events_rebuilds_all_reservation_values() {
    let mut repository = InMemoryReservationRepository::new();
    let expected = reservation(1);
    store_new(&mut repository, &expected);
    assert_eq!(
        repository.find_by_id(&ReservationId::of(1)).unwrap(),
        Some(expected)
    );
}

#[test]
fn unsaved_changes_do_not_change_history_and_saved_events_are_appended() {
    let mut repository = InMemoryReservationRepository::new();
    let original = reservation(1);
    store_new(&mut repository, &original);
    let before = repository.events_for(original.id()).to_vec();
    let mut loaded = repository.find_by_id(original.id()).unwrap().unwrap();
    let event = loaded.cancel().unwrap();
    assert_eq!(
        repository
            .find_by_id(original.id())
            .unwrap()
            .unwrap()
            .status(),
        ReservationStatus::Confirmed
    );
    assert_eq!(repository.events_for(original.id()), before);
    repository
        .store(original.id(), ReservationEvent::Cancelled(event))
        .unwrap();
    assert_eq!(
        &repository.events_for(original.id())[..before.len()],
        before
    );
    assert_eq!(repository.events_for(original.id()).len(), 2);
    assert_eq!(
        repository
            .find_by_id(original.id())
            .unwrap()
            .unwrap()
            .status(),
        ReservationStatus::Cancelled
    );
}

#[test]
fn rejected_events_leave_saved_history_unchanged() {
    let mut repository = InMemoryReservationRepository::new();
    let mut original = reservation(1);
    store_new(&mut repository, &original);
    let before = repository.events_for(original.id()).to_vec();
    assert!(repository
        .store(
            original.id(),
            ReservationEvent::Reserved(original.reserved_event())
        )
        .is_err());
    assert_eq!(repository.events_for(original.id()), before);
    let cancellation = ReservationEvent::Cancelled(original.cancel().unwrap());
    repository
        .store(original.id(), cancellation.clone())
        .unwrap();
    let cancelled = repository.events_for(original.id()).to_vec();
    assert!(repository.store(original.id(), cancellation).is_err());
    assert_eq!(repository.events_for(original.id()), cancelled);
}

#[test]
fn an_event_for_another_id_does_not_create_a_stream() {
    let mut repository = InMemoryReservationRepository::new();
    let original = reservation(1);
    assert!(repository
        .store(
            &ReservationId::of(2),
            ReservationEvent::Reserved(original.reserved_event())
        )
        .is_err());
    assert!(repository.events.is_empty());
}

#[test]
fn a_cancellation_without_a_creation_event_is_rejected() {
    let mut repository = InMemoryReservationRepository::new();
    let mut original = reservation(1);
    let cancellation = original.cancel().unwrap();
    assert!(repository
        .store(original.id(), ReservationEvent::Cancelled(cancellation))
        .is_err());
    assert!(repository.events.is_empty());
}

#[test]
fn corrupt_history_is_a_repository_failure() {
    let mut repository = InMemoryReservationRepository::new();
    let mut original = reservation(1);
    let cancellation = original.cancel().unwrap();
    repository.events.insert(
        original.id().clone(),
        vec![ReservationEvent::Cancelled(cancellation)],
    );
    assert!(repository.find_by_id(original.id()).is_err());
}

#[test]
fn updating_one_stream_preserves_another_stream() {
    let mut repository = InMemoryReservationRepository::new();
    let mut first = reservation(1);
    let second = reservation(2);
    store_new(&mut repository, &first);
    store_new(&mut repository, &second);
    let other_history = repository.events_for(second.id()).to_vec();
    let cancellation = first.cancel().unwrap();
    repository
        .store(first.id(), ReservationEvent::Cancelled(cancellation))
        .unwrap();
    assert_eq!(repository.events_for(second.id()), other_history);
    assert_eq!(repository.find_by_id(second.id()).unwrap(), Some(second));
}
