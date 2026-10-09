use access_domain::access::access_eligibility::{AccessEligibility, AssessAccessEligibilityError};
use access_domain::access::organization::{
    CorruptOrganizationHistory, CreateOrganizationError, Organization, OrganizationCreated,
};
use access_domain::access::user::{CorruptUserHistory, CreateUserError, User, UserCreated};

fn inputs(active: bool, matching: bool, available: bool) -> (Organization, User) {
    let organization = Organization::create(Some("ORG-A".into()), Some(active)).unwrap();
    let user = User::create(
        Some("USER-A".into()),
        Some(if matching { "ORG-A" } else { "ORG-B" }.into()),
        Some(available),
    )
    .unwrap();
    (organization, user)
}

#[test]
fn all_eight_conditions_preserve_failure_priority_and_input_events() {
    use AssessAccessEligibilityError::{
        OrganizationInactive, OrganizationMismatch, UserUnavailable,
    };
    let cases = [
        (true, true, true, Ok(true)),
        (true, true, false, Err(UserUnavailable)),
        (true, false, true, Err(OrganizationMismatch)),
        (true, false, false, Err(OrganizationMismatch)),
        (false, true, true, Err(OrganizationInactive)),
        (false, true, false, Err(OrganizationInactive)),
        (false, false, true, Err(OrganizationInactive)),
        (false, false, false, Err(OrganizationInactive)),
    ];
    let service = AccessEligibility::create();
    for (active, matching, available, expected) in cases {
        let (organization, user) = inputs(active, matching, available);
        let before = (organization.created_event(), user.created_event());
        assert_eq!(service.assess(&organization, &user), expected);
        assert_eq!((organization.created_event(), user.created_event()), before);
        let restored_organization = Organization::replay(&[before.0.clone()]).unwrap();
        let restored_user = User::replay(&[before.1.clone()]).unwrap();
        assert_eq!(
            service.assess(&restored_organization, &restored_user),
            expected
        );
        assert_eq!(
            (
                restored_organization.created_event(),
                restored_user.created_event()
            ),
            before
        );
    }
}

#[test]
fn unrelated_calls_and_other_instances_do_not_change_allow_or_deny() {
    let service = AccessEligibility::create();
    let (allowed_organization, allowed_user) = inputs(true, true, true);
    let (denied_organization, denied_user) = inputs(true, true, false);
    let before = (allowed_user.created_event(), denied_user.created_event());
    assert_eq!(
        service.assess(&allowed_organization, &allowed_user),
        Ok(true)
    );
    assert_eq!(
        service.assess(&denied_organization, &denied_user),
        Err(AssessAccessEligibilityError::UserUnavailable)
    );
    assert_eq!(
        service.assess(&allowed_organization, &allowed_user),
        Ok(true)
    );
    assert_eq!(
        service.assess(&denied_organization, &denied_user),
        Err(AssessAccessEligibilityError::UserUnavailable)
    );
    assert_eq!(
        AccessEligibility::create().assess(&allowed_organization, &allowed_user),
        Ok(true)
    );
    assert_eq!(
        (allowed_user.created_event(), denied_user.created_event()),
        before
    );
}

#[test]
fn missing_current_inputs_are_rejected_but_empty_identifiers_and_false_states_are_valid() {
    assert_eq!(
        Organization::create(None, Some(true)),
        Err(CreateOrganizationError::InvalidInput)
    );
    assert_eq!(
        Organization::create(Some("ORG-A".into()), None),
        Err(CreateOrganizationError::InvalidInput)
    );
    assert_eq!(
        User::create(None, Some("ORG-A".into()), Some(true)),
        Err(CreateUserError::InvalidInput)
    );
    assert_eq!(
        User::create(Some("USER-A".into()), None, Some(true)),
        Err(CreateUserError::InvalidInput)
    );
    assert_eq!(
        User::create(Some("USER-A".into()), Some("ORG-A".into()), None),
        Err(CreateUserError::InvalidInput)
    );
    let organization = Organization::create(Some(String::new()), Some(false)).unwrap();
    let user = User::create(Some(String::new()), Some(String::new()), Some(false)).unwrap();
    assert!(!organization.is_active());
    assert!(!user.is_available());
    assert!(user.belongs_to(&organization));
    assert_eq!(organization.created_event().sequence_number(), 1);
    assert_eq!(user.created_event().sequence_number(), 1);
}

#[test]
fn identity_and_membership_do_not_depend_on_instance_or_availability() {
    let active = Organization::create(Some("ORG-A".into()), Some(true)).unwrap();
    let inactive = Organization::create(Some("ORG-A".into()), Some(false)).unwrap();
    let other = Organization::create(Some("ORG-B".into()), Some(true)).unwrap();
    let user = User::create(Some("USER-A".into()), Some("ORG-A".into()), Some(true)).unwrap();
    let unavailable =
        User::create(Some("USER-A".into()), Some("ORG-B".into()), Some(false)).unwrap();
    assert_eq!(active, inactive);
    assert_ne!(active, other);
    assert_eq!(user, unavailable);
    assert!(user.belongs_to(&active));
    assert!(user.belongs_to(&inactive));
    assert!(!user.belongs_to(&other));
}

#[test]
fn restoration_rejects_missing_duplicate_or_out_of_sequence_history() {
    let (organization, user) = inputs(true, true, true);
    let organization_event = organization.created_event();
    let user_event = user.created_event();
    assert_eq!(
        Organization::replay(&[]),
        Err(CorruptOrganizationHistory::InvalidHistory)
    );
    assert_eq!(User::replay(&[]), Err(CorruptUserHistory::InvalidHistory));
    assert_eq!(
        Organization::replay(&[organization_event.clone(), organization_event]),
        Err(CorruptOrganizationHistory::InvalidHistory)
    );
    assert_eq!(
        User::replay(&[user_event.clone(), user_event]),
        Err(CorruptUserHistory::InvalidHistory)
    );
    let wrong_organization = OrganizationCreated::from_record("ORG-A".into(), true, 2);
    let wrong_user = UserCreated::from_record("USER-A".into(), "ORG-A".into(), true, 0);
    assert_eq!(
        Organization::replay(&[wrong_organization]),
        Err(CorruptOrganizationHistory::InvalidHistory)
    );
    assert_eq!(
        User::replay(&[wrong_user]),
        Err(CorruptUserHistory::InvalidHistory)
    );
}
