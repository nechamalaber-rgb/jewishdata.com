
# Security Recommendation for JewishData.com AI Bridge

To ensure the genealogy assistant remains safe and your 1,000,000+ records are protected, implement these four pillars of security in your middleware:

### 1. Zero-Trust SQL Parameterization
**Do NOT** construct SQL queries using string concatenation. Use placeholders (`?`) provided by your database driver (e.g., `mysql2`, `psycopg2`, `SQLAlchemy`). This effectively neutralizes SQL Injection attempts where a user might try to input `Surname: Cohen; DROP TABLE records;`.

### 2. Attribute-Based Data Filtering
The AI should only see what is necessary for public research. 
- Create a **Data Transfer Object (DTO)** in your API. 
- Explicitly select columns: `SELECT name, date, location FROM records` instead of `SELECT *`.
- Mask or omit sensitive PII (Social Security numbers, exact residential addresses of living individuals, internal user IDs).

### 3. Egress Rate Limiting & Pagination
A malicious bot could use the chat interface to "crawl" your entire database.
- **Limit results:** Always cap the database response to a maximum (e.g., 10 results per query).
- **Throttling:** Implement IP-based rate limiting on the `/api/search` endpoint.
- **Session Analysis:** Flag users who perform 50+ searches in a 10-minute window.

### 4. Semantic Validation
Before passing parameters to SQL, the middleware should validate that the inputs look like names, locations, or years. 
- Use a validation library (like `Joi` or `Zod` in Node, or `Pydantic` in Python).
- If a user sends a 500-character string for a `surname`, reject it before it hits the database.
