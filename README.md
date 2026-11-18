# Music Family engineering portfolio

Selected code and case studies from the software I built for Music Family, a music school. The projects cover three contexts: a live karaoke room, practice between lessons and the studio's day-to-day operations.

| Project                                         | What to look at                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Karaoke](projects/karaoke.md)                  | A fair queue for solos and duets, versioned live state and a [React player](samples/karaoke/youtube.tsx). The [queue scheduler](samples/karaoke/queue.ts) runs locally with synthetic data. |
| [Student practice app](projects/student-app.md) | A React PWA for assignments and feedback, with a [microphone pitch tracker](samples/student-app/usePitchTracker.ts) built on Web Audio.                                                     |
| [Studio operations](projects/operations.md)     | A Telegram payments Mini App, a [per-user update scheduler](samples/payments/update-queue.mjs), website inquiries and CRM-to-calendar sync.                                                 |

## How the project grew

- **June–July 2026.** The first student PWA gained teacher assignments, audio playback and a CRM-backed schedule. The studio website gained inquiry attribution and separate notification delivery.
- **October 2026.** Karaoke entered the website repository with its own client, service and queue rules.
- **November 2026.** The site and karaoke moved into a private monorepo alongside studio integrations. The payments workflow gained expense intake, monthly views and a shorter menu focused on entering transactions.

The dates come from the source repositories. The commits here record the assembly of this portfolio from selected modules. The code samples use the original logic with formatting normalized for this repository. Full applications, live configuration and studio records are private.

## Local checks

Use Node.js 22.18 or newer. The checks cover formatting, linting and TypeScript types for the published excerpts. They require neither studio accounts nor credentials.

```sh
npm ci --ignore-scripts
npm ci --prefix .ci --ignore-scripts
npm run lint
npm run format:check
npm run typecheck
```

## Коротко по-русски

Здесь собраны фрагменты кода и разборы проектов для музыкальной школы. В [караоке](projects/karaoke.md) можно запустить расчёт очереди для соло и дуэтов на вымышленных данных. В [приложении ученика](projects/student-app.md) показано, как браузер определяет ноту с микрофона. В [разборе процессов студии](projects/operations.md) описано, как устроены очередь событий бота, проверка спорных операций в CRM и синхронизация календаря.
