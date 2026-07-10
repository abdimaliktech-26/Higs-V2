const fs = require("fs")
const files = {
  "src/lib/actions/documents.ts": {
    schema: "saveFieldsSchema, addFieldSchema",
    adds: [
      ['import { validate }', `import { validate, saveFieldsSchema, addFieldSchema }`],
    ],
  },
  "src/lib/actions/validation.ts": {
    schema: "createValidationRuleSchema",
    adds: [
      ['import { validate }', `import { validate, createValidationRuleSchema }`],
    ],
  },
  "src/lib/actions/signatures.ts": {
    schema: "createSignatureSchema",
    adds: [
      ['import { validate }', `import { validate, createSignatureSchema }`],
    ],
  },
  "src/lib/actions/users.ts": {
    schema: "createUserSchema, updateUserSchema, orgSettingsSchema",
    adds: [
      ['import { validate }', `import { validate, createUserSchema, updateUserSchema, orgSettingsSchema }`],
    ],
  },
  "src/lib/actions/notifications.ts": {
    schema: "notificationQuerySchema",
    adds: [
      ['import { validate }', `import { validate, notificationQuerySchema }`],
    ],
  },
  "src/lib/actions/audit.ts": {
    schema: "auditQuerySchema",
    adds: [
      ['import { validate }', `import { validate, auditQuerySchema }`],
    ],
  },
}

for (const [file, config] of Object.entries(files)) {
  try {
    let content = fs.readFileSync(file, "utf-8")
    for (const [from, to] of config.adds) {
      content = content.replace(from, to)
    }
    fs.writeFileSync(file, content)
    console.log(`✅ ${file}`)
  } catch (e) {
    console.log(`❌ ${file}: ${e.message}`)
  }
}
