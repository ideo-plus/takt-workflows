use reservation_domain::member_id::MemberId;
use reservation_domain::reservation::reservation_id::ReservationId;
use reservation_domain::reservation::{Reservation, ReservationEvent, ReservationStatus};
use reservation_domain::room_id::RoomId;
use reservation_interface_adapter::in_memory_reservation_repository::InMemoryReservationRepository;
use reservation_use_case::reservation_repository::ReservationRepository;
use std::time::{Duration, UNIX_EPOCH};

fn reserve(member: u64, room: u64, start: u64, end: u64) -> Reservation {
    Reservation::reserve(
        ReservationId::of(1),
        MemberId::of(member),
        RoomId::of(room),
        UNIX_EPOCH + Duration::from_secs(start),
        UNIX_EPOCH + Duration::from_secs(end),
    )
    .unwrap()
}

#[test]
fn rejects_inconsistent_creation_without_consuming_sequence() {
    for interval in [1, 3] {
        for (member, room, start, end) in [
            (99, 3, 1000, 2000),
            (2, 99, 1000, 2000),
            (2, 3, 1100, 2000),
            (2, 3, 1000, 2100),
        ] {
            let mut repository = InMemoryReservationRepository::new(interval);
            let original = reserve(2, 3, 1000, 2000);
            assert!(repository
                .store(
                    ReservationEvent::Reserved(original.reserved_event()),
                    reserve(member, room, start, end)
                )
                .is_err());
            assert!(repository.find_by_id(original.id()).unwrap().is_none());
            repository
                .store(
                    ReservationEvent::Reserved(original.reserved_event()),
                    original,
                )
                .unwrap();
        }
    }
}

#[test]
fn rejects_inconsistent_cancellation_without_changing_stored_state() {
    for interval in [1, 3] {
        for (member, room, start, end) in [
            (99, 3, 1000, 2000),
            (2, 99, 1000, 2000),
            (2, 3, 1100, 2000),
            (2, 3, 1000, 2100),
        ] {
            let mut repository = InMemoryReservationRepository::new(interval);
            let mut original = reserve(2, 3, 1000, 2000);
            repository
                .store(
                    ReservationEvent::Reserved(original.reserved_event()),
                    original.clone(),
                )
                .unwrap();
            let event = ReservationEvent::Cancelled(original.cancel().unwrap());
            let mut mismatched = reserve(member, room, start, end);
            mismatched.cancel().unwrap();
            assert!(repository.store(event.clone(), mismatched).is_err());
            let unchanged = repository.find_by_id(original.id()).unwrap().unwrap();
            assert_eq!(unchanged.status(), ReservationStatus::Confirmed);
            assert_eq!(unchanged.sequence_number(), 1);
            assert_eq!(unchanged.reserved_event(), original.reserved_event());
            repository.store(event, original.clone()).unwrap();
            assert_eq!(
                repository
                    .find_by_id(original.id())
                    .unwrap()
                    .unwrap()
                    .status(),
                ReservationStatus::Cancelled
            );
        }
    }
}
