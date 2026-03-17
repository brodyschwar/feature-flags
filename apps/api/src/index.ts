import express from 'express';
import type { Request, Response } from 'express'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(express.json())

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`)
})