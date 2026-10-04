use std::time::{Duration, UNIX_EPOCH};

use super::{CreateTimeSlotError, TimeSlot};

#[test]
fn time_slot_accepts_an_end_after_its_start() {
    let start = UNIX_EPOCH + Duration::from_secs(3_600);
    let end = start + Duration::from_secs(1_800);

    let time_slot = TimeSlot::create(start, end).expect("the time slot should be valid");

    assert_eq!(time_slot.start(), &start);
    assert_eq!(time_slot.end(), &end);
}

#[test]
fn time_slot_rejects_an_end_equal_to_its_start() {
    let start = UNIX_EPOCH + Duration::from_secs(3_600);

    assert_eq!(
        TimeSlot::create(start, start),
        Err(CreateTimeSlotError::EndNotAfterStart)
    );
}

#[test]
fn time_slot_rejects_an_end_before_its_start() {
    let start = UNIX_EPOCH + Duration::from_secs(3_600);
    let end = start - Duration::from_secs(1);

    assert_eq!(
        TimeSlot::create(start, end),
        Err(CreateTimeSlotError::EndNotAfterStart)
    );
}
