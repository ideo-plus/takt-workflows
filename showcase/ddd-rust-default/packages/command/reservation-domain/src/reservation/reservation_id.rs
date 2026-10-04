#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseReservationIdError {
    NotPositive,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ReservationId(u64);

impl ReservationId {
    pub fn of(value: u64) -> Self {
        Self::parse(value).expect("ReservationIdは1以上の整数である必要があります")
    }

    /// 非整数入力は型検査で拒否する。
    /// ```compile_fail
    /// use reservation_domain::reservation::reservation_id::ReservationId;
    /// let _ = ReservationId::parse(1.5);
    /// ```
    pub fn parse(value: u64) -> Result<Self, ParseReservationIdError> {
        if value < 1 {
            return Err(ParseReservationIdError::NotPositive);
        }
        Ok(Self(value))
    }
}

#[cfg(test)]
mod tests;
