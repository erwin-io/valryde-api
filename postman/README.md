# Valryde Agent A Postman workflow

This folder contains a local Postman collection for Agent A checklist IDs 1–11. It does not contain database credentials, passwords, JWTs, email challenge tokens, Google tokens, or Traccar secrets.

## Immediate smoke test

Start the API, then run:

```powershell
npm run postman:smoke
```

This checks `GET /api/health` and the paginated public `GET /api/transit-routes` contract. It does not create or change data.

## Full workflow prerequisites

Import both JSON files into Postman, duplicate the environment for your own local values, and fill in:

- `operatorEmail` and `operatorPassword`: temporary credentials for a new Operator test account. Use a unique email for every full run.
- `driverEmail` and `driverPassword`: temporary credentials for a new Driver test account.
- `adminEmail` and `adminPassword`: credentials for an existing internal Admin account created by the approved bootstrap command.
- `mailpitUrl`: defaults to the local Mailpit web/API origin. Verification tokens are read from Mailpit only at runtime and are never saved in the collection.
- `imei`, `serialNumber`, and `traccarUniqueId`: required only for the separately operator-gated physical GPS steps.

Do not commit an exported environment after adding local values. Prefer Postman Vault for durable local secrets. The checked-in environment intentionally has empty secret values.

Google sign-in is represented as a separate manual request and needs a current Google ID token plus a configured `GOOGLE_CLIENT_IDS` value. It is not part of the deterministic email/password run.

Set `runRegistration=true` for a new local E2E run. The collection retrieves Operator and Driver verification messages from Mailpit at runtime. Keep `runPhysicalGpsWorkflow=false`; scheduling, device mapping, installation, and physical verification require real operator evidence and must not be simulated.

## Full run order

Run the collection in its saved order:

1. Health and public route checks.
2. Register and verify the Operator, then log in.
3. Register and verify a Driver, then associate that Driver with the Operator.
4. Create the jeepney and fleet group.
5. Log in as Admin and create/activate a route and direction.
6. Validate route search/details, then assign the route as Operator.
7. Submit and approve the vehicle application.
8. Request and approve GPS setup.
9. Refresh and log out the Operator session.

The collection captures IDs and access/refresh tokens in the selected local environment during the run. It does not delete the domain records it creates because the current API has no authorized delete endpoints. Use a dedicated local test database or clean test records through an approved maintenance process.

Run the complete collection from the command line after all required values are available:

```powershell
npm run postman:e2e
```

To avoid putting secrets in shell history, edit only a private copy of the environment or use Postman Vault. The repository environment remains a credential-free template.

## Expected operator gates

- Local email verification requires Mailpit. Production SMTP remains owner-configured.
- Admin-only steps cannot continue until the secure Admin bootstrap command has created an account.
- Google sign-in needs owner-managed OAuth configuration.
- Physical scheduling, device mapping, installation, activation, and live Traccar connectivity are operator-gated. They are skipped unless `runPhysicalGpsWorkflow=true` and must not be enabled without real hardware evidence.
