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
            ReservationEvent::Reserved(reservation.reserved_event()),
            reservation.clone(),
        )
        .unwrap();
}

fn store_cancellation(repository: &mut InMemoryReservationRepository, id: &ReservationId) {
    let mut loaded = repository.find_by_id(id).unwrap().unwrap();
    let event = loaded.cancel().unwrap();
    repository
        .store(ReservationEvent::Cancelled(event), loaded)
        .unwrap();
}

#[test]
fn a_missing_reservation_is_none() {
    let repository = InMemoryReservationRepository::new(1);
    assert_eq!(repository.find_by_id(&ReservationId::of(1)).unwrap(), None);
}

#[test]
#[should_panic]
fn a_zero_snapshot_interval_is_rejected() {
    InMemoryReservationRepository::new(0);
}

#[test]
fn storing_the_reservation_keeps_all_its_values() {
    let mut repository = InMemoryReservationRepository::new(1);
    let expected = reservation(1);
    store_new(&mut repository, &expected);
    assert_eq!(
        repository.find_by_id(&ReservationId::of(1)).unwrap(),
        Some(expected)
    );
}

#[test]
fn unsaved_changes_do_not_change_the_stored_reservation() {
    let mut repository = InMemoryReservationRepository::new(1);
    let original = reservation(1);
    store_new(&mut repository, &original);
    let mut loaded = repository.find_by_id(original.id()).unwrap().unwrap();
    loaded.cancel().unwrap();
    assert_eq!(
        repository.find_by_id(original.id()).unwrap(),
        Some(original)
    );
}

#[test]
fn a_cancellation_between_snapshots_is_replayed_from_the_events_after_the_snapshot() {
    let mut repository = InMemoryReservationRepository::new(3);
    let original = reservation(1);
    store_new(&mut repository, &original);
    store_cancellation(&mut repository, original.id());

    let loaded = repository.find_by_id(original.id()).unwrap().unwrap();

    assert_eq!(loaded.status(), ReservationStatus::Cancelled);
    assert_eq!(loaded.sequence_number(), 2);
}

#[test]
fn a_corrupt_event_after_the_snapshot_is_a_repository_failure() {
    let mut repository = InMemoryReservationRepository::new(3);
    let mut original = reservation(1);
    store_new(&mut repository, &original);
    let cancellation = ReservationEvent::Cancelled(original.cancel().unwrap());
    repository
        .events
        .get_mut(original.id())
        .unwrap()
        .extend([cancellation.clone(), cancellation]);
    assert!(repository.find_by_id(original.id()).is_err());
}

#[test]
fn a_cancellation_on_a_snapshot_is_loaded_without_replaying_earlier_events() {
    let mut repository = InMemoryReservationRepository::new(1);
    let original = reservation(1);
    store_new(&mut repository, &original);
    store_cancellation(&mut repository, original.id());
    repository.events.get_mut(original.id()).unwrap().remove(0);

    let loaded = repository.find_by_id(original.id()).unwrap().unwrap();

    assert_eq!(loaded.status(), ReservationStatus::Cancelled);
    assert_eq!(loaded.sequence_number(), 2);
}

#[test]
fn a_snapshot_that_is_not_the_state_after_the_event_is_rejected() {
    let mut repository = InMemoryReservationRepository::new(1);
    let original = reservation(1);
    store_new(&mut repository, &original);
    let mut loaded = repository.find_by_id(original.id()).unwrap().unwrap();
    let cancellation = ReservationEvent::Cancelled(loaded.cancel().unwrap());

    assert!(repository
        .store(cancellation.clone(), original.clone())
        .is_err());
    assert!(repository.store(cancellation, reservation(2)).is_err());
    assert_eq!(
        repository.find_by_id(original.id()).unwrap(),
        Some(original)
    );
}

#[test]
fn an_event_that_does_not_follow_the_stored_history_is_rejected() {
    let mut repository = InMemoryReservationRepository::new(1);
    let mut original = reservation(1);
    let unsaved = original.clone();
    let cancellation = ReservationEvent::Cancelled(original.cancel().unwrap());

    assert!(repository
        .store(cancellation.clone(), original.clone())
        .is_err());
    assert_eq!(repository.find_by_id(original.id()).unwrap(), None);

    store_new(&mut repository, &unsaved);
    assert!(repository
        .store(
            ReservationEvent::Reserved(unsaved.reserved_event()),
            unsaved.clone()
        )
        .is_err());
    repository
        .store(cancellation.clone(), original.clone())
        .unwrap();
    assert!(repository.store(cancellation, original.clone()).is_err());
    assert_eq!(
        repository.find_by_id(original.id()).unwrap(),
        Some(original)
    );
}

#[test]
fn updating_one_stream_preserves_another_stream() {
    let mut repository = InMemoryReservationRepository::new(1);
    let first = reservation(1);
    let second = reservation(2);
    store_new(&mut repository, &first);
    store_new(&mut repository, &second);
    store_cancellation(&mut repository, first.id());
    assert_eq!(repository.find_by_id(second.id()).unwrap(), Some(second));
}
