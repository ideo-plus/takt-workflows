#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseUserIdError {
    MissingValue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserId(String);

impl UserId {
    fn new(value: String) -> Self {
        Self(value)
    }

    pub fn of(value: &str) -> Self {
        Self::parse(Some(value)).expect("UserId requires a present string")
    }

    pub fn parse(value: Option<&str>) -> Result<Self, ParseUserIdError> {
        let value = value.ok_or(ParseUserIdError::MissingValue)?;
        Ok(Self::new(value.to_owned()))
    }

    pub fn value(&self) -> &str {
        &self.0
    }
}
