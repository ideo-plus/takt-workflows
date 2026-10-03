#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeSlot {
    start: i64,
    end: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimeSlotError {
    EndNotAfterStart,
}

impl TimeSlot {
    pub fn new(start: i64, end: i64) -> Result<Self, TimeSlotError> {
        if end <= start {
            return Err(TimeSlotError::EndNotAfterStart);
        }
        Ok(Self { start, end })
    }

    pub fn start(&self) -> i64 {
        self.start
    }

    pub fn end(&self) -> i64 {
        self.end
    }
}
