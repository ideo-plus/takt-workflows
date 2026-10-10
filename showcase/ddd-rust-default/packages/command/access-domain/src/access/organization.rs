#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateOrganizationError {
    MissingId,
    MissingActive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CorruptOrganizationHistory;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrganizationCreated {
    organization_id: String,
    active: bool,
    sequence_number: u64,
}

impl OrganizationCreated {
    fn new(organization_id: &str, active: bool) -> Self {
        Self {
            organization_id: organization_id.to_string(),
            active,
            sequence_number: 1,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Organization {
    creation: OrganizationCreated,
}

impl Organization {
    fn new(creation: OrganizationCreated) -> Self {
        Self { creation }
    }

    pub fn create(id: Option<&str>, active: Option<bool>) -> Result<Self, CreateOrganizationError> {
        let id = id.ok_or(CreateOrganizationError::MissingId)?;
        let active = active.ok_or(CreateOrganizationError::MissingActive)?;
        let event = OrganizationCreated::new(id, active);
        Ok(Self::from_created(&event))
    }

    pub fn from_created(event: &OrganizationCreated) -> Self {
        Self::new(event.clone())
    }

    pub fn created_event(&self) -> OrganizationCreated {
        self.creation.clone()
    }

    pub fn sequence_number(&self) -> u64 {
        self.creation.sequence_number
    }

    pub fn replay(
        events: &[OrganizationCreated],
        snapshot: Self,
    ) -> Result<Self, CorruptOrganizationHistory> {
        // 宣言されたイベントは生成だけなので、既存集約に有効な続きはない。
        if !events.is_empty() {
            return Err(CorruptOrganizationHistory);
        }
        Ok(snapshot)
    }

    pub fn is_active(&self) -> bool {
        self.creation.active
    }

    pub fn is_identified_by(&self, identifier: &str) -> bool {
        self.creation.organization_id == identifier
    }
}
