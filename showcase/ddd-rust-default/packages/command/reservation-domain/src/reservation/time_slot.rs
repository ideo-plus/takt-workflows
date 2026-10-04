use std::time::SystemTime;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateTimeSlotError {
    EndNotAfterStart,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeSlot {
    start: SystemTime,
    end: SystemTime,
}

impl TimeSlot {
    pub fn create(start: SystemTime, end: SystemTime) -> Result<Self, CreateTimeSlotError> {
        if end <= start {
            return Err(CreateTimeSlotError::EndNotAfterStart);
        }
        Ok(Self { start, end })
    }

    pub fn start(&self) -> &SystemTime {
        &self.start
    }

    pub fn end(&self) -> &SystemTime {
        &self.end
    }
}

#[cfg(test)]
mod tests;
