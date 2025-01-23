# Tools Schema Generator

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D16.0.0-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-4.x-blue)

Tools Schema Generator is a utility for generating JSON schemas from JSDoc comments to streamline the integration of tools with OpenAI's function calling.
This package helps developers create well-structured schemas to define tool behavior, making it easier to build AI agents with dynamic capabilities.

---

## Features

- **OpenAI Function Calling Support**: Automatically generates JSON schemas compatible with OpenAI's function calling feature.
- **Streamlined Agent Creation**: Simplifies the process of defining tools for AI agents.
- **JSDoc Parsing**: Parses JSDoc comments from TypeScript and JavaScript files.
- **Complex Schema Support**: Handles unions, enums, nested objects, and optional parameters.
- **Validation**: Ensures schema types are valid and adheres to JSON schema standards.

---

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/your-username/tools_schema_generator.git
   cd tools_schema_generator
   ```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Usage

Run the Schema Generator:

```bash
npm start
```

The tool will:

- Parse .ts and .js files in the services directory.
- Generate JSON schemas for tools.
- Save the output to schemas.json.

## Usage

### For TypeScript Files

To generate schemas from TypeScript files, ensure your files are structured with JSDoc comments. Here's an example:

```typescript
interface User {
  name: string;
  age: number;
  address?: Address;
}

interface Address {
  street: string;
  city?: string | number;
  country?: string;
}

/**
 * @description Fetch the token balance for a user based on their username and token details.
 * @param user The user. This can be a wallet address, Discord ID, etc.
 * @param token The token to search for, which can be its symbol, address, or name.
 */
export async function getUserTokenBalance({
  user,
  token,
}: {
  user: User;
  token: number;
}): Promise<void> {}
```

## Run the schema generator:

```bash
npm start
```

This will scan your TypeScript files (.ts) in the services directory, parse the JSDoc comments, and generate corresponding JSON schemas.

### For JavaScript Files

Similarly, for JavaScript files, ensure JSDoc comments are used:

```javascript
/**
 * Fetch the token balance for a user based on their username and token details.
 * @param {string} userName - The username of the user. This can be a wallet address, Discord ID, etc.
 * @param {number | string} [token] - The token to search for, which can be its symbol, address, or name.
 */
export async function getUserTokenBalanceJs({ userName, token }) {}
```

Run the schema generator:

```bash
npm start
```

This will scan your JavaScript files (.js) in the services directory, parse the JSDoc comments, and generate JSON schemas.

## General Instructions

- Output: After running the command, the generated schemas will be saved in schemas.json at the root of your project.
- Validation: The tool will validate the schemas to ensure they conform to JSON Schema standards. Errors in JSDoc comments (like invalid types) will be reported.

## Integrate with OpenAI:

Use the generated schemas to define tools for OpenAI's function calling:

```javascript
const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

const toolsSchema = require("./schemas.json");

const response = await openai.createChatCompletion({
  model: "gpt-4-0613",
  messages: [{ role: "user", content: "What's my account balance?" }],
  functions: toolsSchema,
});

console.log(response.data);
```

This setup allows your AI agents or applications to understand and use the functions defined in your code without the need to manually create the files.

## Output Example

Example schema for a tool:

```json
[
  {
    "type": "function",
    "function": {
      "name": "getUserTokenBalance",
      "description": "Fetch the token balance for a user based on their username and token details.",
      "parameters": {
        "type": "object",
        "properties": {
          "userName": {
            "type": "string",
            "description": "The username of the user. This can be a wallet address, Discord ID, etc."
          },
          "token": {
            "oneOf": [{ "type": "number" }, { "type": "string" }],
            "description": "The token to search for, which can be its symbol, address, or name."
          }
        },
        "required": ["userName", "token"]
      }
    }
  }
]
```

## Configuration

Directory Structure:

- Input: By default, the tool scans the services directory for .ts and .js files.

- Output: Schemas are saved to schemas.json in the root directory.

## Error Handling:

Invalid types in JSDoc comments throw detailed errors:

```php
Error: Invalid type: obj. Valid types are: string, number, integer, boolean, object, array, null.
```

## Development

File Structure

```graphql
.
├── dist/               # Compiled JavaScript files
├── src/                # Source files
│   ├── parser/         # Parsing logic
│   │   ├── parseJs.ts  # JSDoc parser for JavaScript
│   │   ├── parseTs.ts  # JSDoc parser for TypeScript
│   └── index.ts        # Entry point for parsing
├── services/           # Example files to parse
├── schemas.json        # Generated schema output
├── types/              # Shared types and interfaces
├── package.json        # Node.js dependencies
└── tsconfig.json       # TypeScript configuration
```

## Scripts

- Build: Compiles TypeScript to JavaScript.

```bash
npm run build
```

- Start: Runs the schema generator.

```bash
npm start
```

## Contributing

Contributions are welcome! If you want to report bugs or suggest improvements, feel free to open an issue.

## License

This project is licensed under the MIT License.
