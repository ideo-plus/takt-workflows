#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseOrgIdError {
    MissingValue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrgId(String);

impl OrgId {
    fn new(value: String) -> Self {
        Self(value)
    }

    pub fn of(value: &str) -> Self {
        Self::parse(Some(value)).expect("OrgId requires a present string")
    }

    pub fn parse(value: Option<&str>) -> Result<Self, ParseOrgIdError> {
        let value = value.ok_or(ParseOrgIdError::MissingValue)?;
        Ok(Self::new(value.to_owned()))
    }

    pub fn value(&self) -> &str {
        &self.0
    }
}
