import { createLogger } from 'vue-logger-plugin'

// create logger with options
const logger = createLogger({
  enabled: true,
  level: import.meta.env.DEV ? 'debug' : 'info',
})

export default logger
