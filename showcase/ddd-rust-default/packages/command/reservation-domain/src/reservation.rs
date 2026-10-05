pub mod reservation_id;
pub mod time_slot;

use crate::member_id::MemberId;
use crate::room_id::RoomId;
use reservation_id::ReservationId;
use std::time::SystemTime;
use time_slot::TimeSlot;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReservationStatus {
    Confirmed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReserveReservationError {
    InvalidTimeSlot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorruptReservationHistory {
    WrongReservation,
    OutOfSequence,
    InvalidTransition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReservationError {
    AlreadyCancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationReserved {
    reservation_id: ReservationId,
    sequence_number: u64,
    member_id: MemberId,
    room_id: RoomId,
    time_slot: TimeSlot,
}

impl ReservationReserved {
    fn new(
        reservation_id: ReservationId,
        member_id: MemberId,
        room_id: RoomId,
        time_slot: TimeSlot,
    ) -> Self {
        Self {
            reservation_id,
            sequence_number: 1,
            member_id,
            room_id,
            time_slot,
        }
    }
    pub fn reservation_id(&self) -> &ReservationId {
        &self.reservation_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReservationCancelled {
    reservation_id: ReservationId,
    sequence_number: u64,
}

impl ReservationCancelled {
    fn new(reservation_id: ReservationId, sequence_number: u64) -> Self {
        Self {
            reservation_id,
            sequence_number,
        }
    }
    pub fn reservation_id(&self) -> &ReservationId {
        &self.reservation_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReservationEvent {
    Reserved(ReservationReserved),
    Cancelled(ReservationCancelled),
}

impl ReservationEvent {
    pub fn reservation_id(&self) -> &ReservationId {
        match self {
            Self::Reserved(event) => event.reservation_id(),
            Self::Cancelled(event) => event.reservation_id(),
        }
    }

    pub fn sequence_number(&self) -> u64 {
        match self {
            Self::Reserved(event) => event.sequence_number,
            Self::Cancelled(event) => event.sequence_number,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reservation {
    id: ReservationId,
    sequence_number: u64,
    member_id: MemberId,
    room_id: RoomId,
    time_slot: TimeSlot,
    status: ReservationStatus,
}

impl Reservation {
    fn new(
        id: ReservationId,
        sequence_number: u64,
        member_id: MemberId,
        room_id: RoomId,
        time_slot: TimeSlot,
        status: ReservationStatus,
    ) -> Self {
        Self {
            id,
            sequence_number,
            member_id,
            room_id,
            time_slot,
            status,
        }
    }

    pub fn reserve(
        id: ReservationId,
        member_id: MemberId,
        room_id: RoomId,
        start: SystemTime,
        end: SystemTime,
    ) -> Result<Self, ReserveReservationError> {
        let time_slot =
            TimeSlot::create(start, end).map_err(|_| ReserveReservationError::InvalidTimeSlot)?;
        let event = ReservationReserved::new(id, member_id, room_id, time_slot);
        Ok(Self::from_reserved(&event))
    }

    pub fn reserved_event(&self) -> ReservationReserved {
        ReservationReserved::new(
            self.id.clone(),
            self.member_id.clone(),
            self.room_id.clone(),
            self.time_slot.clone(),
        )
    }

    pub fn replay(
        events: &[ReservationEvent],
        snapshot: Reservation,
    ) -> Result<Self, CorruptReservationHistory> {
        let mut reservation = snapshot;
        for event in events {
            if event.reservation_id() != &reservation.id {
                return Err(CorruptReservationHistory::WrongReservation);
            }
            if event.sequence_number() != reservation.sequence_number + 1 {
                return Err(CorruptReservationHistory::OutOfSequence);
            }
            match event {
                ReservationEvent::Cancelled(cancelled)
                    if reservation.status == ReservationStatus::Confirmed =>
                {
                    reservation.apply_cancelled(cancelled);
                }
                _ => return Err(CorruptReservationHistory::InvalidTransition),
            }
        }
        Ok(reservation)
    }

    fn from_reserved(event: &ReservationReserved) -> Self {
        Self::new(
            event.reservation_id.clone(),
            event.sequence_number,
            event.member_id.clone(),
            event.room_id.clone(),
            event.time_slot.clone(),
            ReservationStatus::Confirmed,
        )
    }

    fn apply_cancelled(&mut self, event: &ReservationCancelled) {
        self.sequence_number = event.sequence_number;
        self.status = ReservationStatus::Cancelled;
    }

    pub fn cancel(&mut self) -> Result<ReservationCancelled, CancelReservationError> {
        if self.status == ReservationStatus::Cancelled {
            return Err(CancelReservationError::AlreadyCancelled);
        }
        let event = ReservationCancelled::new(self.id.clone(), self.sequence_number + 1);
        self.apply_cancelled(&event);
        Ok(event)
    }

    pub fn id(&self) -> &ReservationId {
        &self.id
    }
    pub fn sequence_number(&self) -> u64 {
        self.sequence_number
    }
    pub fn member_id(&self) -> &MemberId {
        &self.member_id
    }
    pub fn room_id(&self) -> &RoomId {
        &self.room_id
    }
    pub fn time_slot(&self) -> &TimeSlot {
        &self.time_slot
    }
    pub fn status(&self) -> ReservationStatus {
        self.status
    }
}

#[cfg(test)]
mod tests;
