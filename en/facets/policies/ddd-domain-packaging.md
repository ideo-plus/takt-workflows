# DDD Domain Packaging Policy

Defines the names of domain-layer packages and modules and how types are grouped into modules. A module is a Module in Evans's sense: part of the model, grouping cohesive concepts. Names come from the ubiquitous language, never from technical classification. Declaring the business term behind each name (`domain_packages` in the aggregate mapping) belongs to the domain model policy.

| Criterion | Judgment |
|-----------|----------|
| A package or module is named `aggregate(s)`, `impl(s)`, `implementation(s)`, `vo(s)`, `entity`, `entities`, `value_object(s)`, `valueobject(s)`, or a bare `domain` | REJECT |
| Aggregates, Entities, and value objects of the same business concept are split into modules by type kind only | REJECT |
| A type that belongs to one business concept (the identifier of an aggregate root, its value objects, a command ID the aggregate remembers) sits outside that concept's module (`invoice-id` beside `invoice`) | REJECT. Place it under the concept's module (`invoice/invoice-id`) |
| The root of a domain package lines up concepts so that which of them belong together cannot be read from it | REJECT. Group cohesive concepts into modules named in the ubiquitous language, with few dependencies between modules |
| While the concepts are few, a value several concepts use (`money`) or an ID that refers to another aggregate (`customer-id`) sits at the root as a module named by its responsibility | OK |
| A shared value is placed in a bucket such as `common/vo` instead of a module named by its responsibility (`money`, `address`) | REJECT |
| `common`, `shared`, or `utils` holds domain concepts | Warning. Justify it as a business term or rename it |
| A layer marker such as the `-domain` suffix or the `packages/domain` placement | OK. It marks a layer, not a technical classification |

Directory examples that group code by kind, such as `aggregate/`, `model/`, `services/`, or `repositories/`, do not apply to domain-layer code.
