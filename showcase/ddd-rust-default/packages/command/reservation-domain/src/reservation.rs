mod reservation_cancelled;
mod reservation_confirmed;
mod reservation_id;
mod time_slot;

pub use reservation_cancelled::ReservationCancelled;
pub use reservation_confirmed::ReservationConfirmed;
pub use reservation_id::ReservationId;
pub use time_slot::{TimeSlot, TimeSlotError};

use crate::{MemberId, RoomId};

#[derive(Debug, Clone)]
pub struct Reservation {
    id: ReservationId,
    member_id: MemberId,
    room_id: RoomId,
    time_slot: TimeSlot,
    status: ReservationStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReservationStatus {
    Uncreated,
    Confirmed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReservationError {
    AlreadyCancelled,
    NotConfirmed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReservationConfirmationError {
    AlreadyConfirmed,
    AlreadyCancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreateReservationError {
    EndNotAfterStart,
}

impl Reservation {
    pub fn reserve_room(&mut self) -> Result<ReservationConfirmed, ReservationConfirmationError> {
        match self.status {
            ReservationStatus::Confirmed => {
                return Err(ReservationConfirmationError::AlreadyConfirmed)
            }
            ReservationStatus::Cancelled => {
                return Err(ReservationConfirmationError::AlreadyCancelled)
            }
            ReservationStatus::Uncreated => {}
        }
        self.status = ReservationStatus::Confirmed;
        Ok(ReservationConfirmed::new(self.id.clone()))
    }

    pub fn create(
        id: ReservationId,
        member_id: MemberId,
        room_id: RoomId,
        start: i64,
        end: i64,
    ) -> Result<Self, CreateReservationError> {
        let time_slot = TimeSlot::new(start, end).map_err(|error| match error {
            TimeSlotError::EndNotAfterStart => CreateReservationError::EndNotAfterStart,
        })?;
        Ok(Self::from_parts(
            id,
            member_id,
            room_id,
            time_slot,
            ReservationStatus::Uncreated,
        ))
    }

    pub fn restore(
        id: ReservationId,
        member_id: MemberId,
        room_id: RoomId,
        time_slot: TimeSlot,
        status: ReservationStatus,
    ) -> Self {
        Self::from_parts(id, member_id, room_id, time_slot, status)
    }

    fn from_parts(
        id: ReservationId,
        member_id: MemberId,
        room_id: RoomId,
        time_slot: TimeSlot,
        status: ReservationStatus,
    ) -> Self {
        Self {
            id,
            member_id,
            room_id,
            time_slot,
            status,
        }
    }

    pub fn cancel(&mut self) -> Result<ReservationCancelled, ReservationError> {
        match self.status {
            ReservationStatus::Cancelled => return Err(ReservationError::AlreadyCancelled),
            ReservationStatus::Uncreated => return Err(ReservationError::NotConfirmed),
            ReservationStatus::Confirmed => {}
        }
        self.status = ReservationStatus::Cancelled;
        Ok(ReservationCancelled::new(self.id.clone()))
    }

    pub fn id(&self) -> &ReservationId {
        &self.id
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

    pub fn is_confirmed(&self) -> bool {
        matches!(self.status, ReservationStatus::Confirmed)
    }

    pub fn status(&self) -> ReservationStatus {
        self.status
    }

    pub fn is_cancelled(&self) -> bool {
        matches!(self.status, ReservationStatus::Cancelled)
    }
}
