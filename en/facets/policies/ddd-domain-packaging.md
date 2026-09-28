# DDD Domain Packaging Policy

Defines the names of domain-layer packages and modules: they come from the ubiquitous language, never from technical classification. Declaring the business term behind each name (`domain_packages` in the aggregate mapping) belongs to the domain model policy.

| Criterion | Judgment |
|-----------|----------|
| A package or module is named `aggregate(s)`, `impl(s)`, `implementation(s)`, `vo(s)`, `entity`, `entities`, `value_object(s)`, `valueobject(s)`, or a bare `domain` | REJECT |
| Aggregates, Entities, and value objects of the same business concept are split into modules by type kind only | REJECT |
| A shared value is placed in a bucket such as `common/vo` instead of a module named by its responsibility (`money`, `address`) | REJECT |
| `common`, `shared`, or `utils` holds domain concepts | Warning. Justify it as a business term or rename it |
| A layer marker such as the `-domain` suffix or the `packages/domain` placement | OK. It marks a layer, not a technical classification |

Directory examples that group code by kind, such as `aggregate/`, `model/`, `services/`, or `repositories/`, do not apply to domain-layer code.
