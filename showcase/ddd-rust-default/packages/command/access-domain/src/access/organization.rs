#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreateOrganizationError {
    InvalidInput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CorruptOrganizationHistory {
    InvalidHistory,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrganizationCreated {
    organization_id: String,
    active: bool,
    sequence_number: u64,
}

impl OrganizationCreated {
    fn new(organization_id: String, active: bool, sequence_number: u64) -> Self {
        Self {
            organization_id,
            active,
            sequence_number,
        }
    }

    pub fn from_record(organization_id: String, active: bool, sequence_number: u64) -> Self {
        Self::new(organization_id, active, sequence_number)
    }

    pub fn organization_id(&self) -> &str {
        &self.organization_id
    }

    pub fn sequence_number(&self) -> u64 {
        self.sequence_number
    }
}

#[derive(Debug, Clone)]
pub struct Organization {
    created: OrganizationCreated,
}

impl Organization {
    fn new(created: OrganizationCreated) -> Self {
        Self { created }
    }

    pub fn create(
        id: Option<String>,
        active: Option<bool>,
    ) -> Result<Self, CreateOrganizationError> {
        let (Some(id), Some(active)) = (id, active) else {
            return Err(CreateOrganizationError::InvalidInput);
        };
        let event = OrganizationCreated::new(id, active, 1);
        Ok(Self::from_created(&event))
    }

    pub fn replay(events: &[OrganizationCreated]) -> Result<Self, CorruptOrganizationHistory> {
        if events.len() != 1 {
            return Err(CorruptOrganizationHistory::InvalidHistory);
        }
        let event = &events[0];
        if event.sequence_number != 1 {
            return Err(CorruptOrganizationHistory::InvalidHistory);
        }
        Ok(Self::from_created(event))
    }

    fn from_created(event: &OrganizationCreated) -> Self {
        Self::new(event.clone())
    }

    pub fn created_event(&self) -> OrganizationCreated {
        self.created.clone()
    }

    pub fn is_active(&self) -> bool {
        self.created.active == true
    }

    pub fn is_identified_by(&self, organization_id: &str) -> bool {
        self.created.organization_id == organization_id
    }
}

impl PartialEq for Organization {
    fn eq(&self, other: &Self) -> bool {
        self.created.organization_id == other.created.organization_id
    }
}

impl Eq for Organization {}
