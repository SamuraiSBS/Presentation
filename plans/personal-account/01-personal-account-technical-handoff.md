# StudyDeck: личный кабинет, Telegram-вход, папки и совместная работа

## Назначение документа

Это самодостаточный технический handoff для нового чата Codex. Нужно реализовать личный кабинет StudyDeck в текущем монорепозитории `D:\presentation`, а не создавать отдельное приложение или менять legacy MVP в корне.

Перед изменениями:

1. Прочитать `AGENTS.md`, `PRODUCT.md`, `DESIGN.md` и проверить текущий `git status`.
2. Не откатывать посторонние пользовательские изменения в грязном worktree.
3. Использовать существующие библиотеки: Next.js App Router, Auth.js/NextAuth v4, Prisma, NestJS, Zod, TanStack Query, Radix UI, Lucide, Vitest и Playwright.
4. Сохранить существующий оранжевый визуальный язык StudyDeck: оранжевый — действие, зелёный — готовность, фиолетовый — AI/editor. Не затрагивать темы слайдов и экспортный рендеринг без необходимости.
5. Реализовывать по этапам ниже, но не оставлять безопасность и права доступа «на потом»: после появления совместных проектов owner-only проверки становятся неверными во всех существующих сервисах.

## Зафиксированные продуктовые решения

- Аудитория: школьники и студенты.
- После входа открывается общий обзор `/dashboard`.
- Вход: Telegram Login на сайте, не Telegram Mini App.
- На старте используется бесплатный информационный тариф без оплаты.
- Лимит: 10 новых презентаций за календарный месяц.
- Период обновляется первого числа месяца по часовому поясу `Europe/Moscow`.
- При исчерпании лимита блокируются создание и дублирование. Просмотр, редактирование и экспорт существующих презентаций продолжают работать.
- Совместный проект учитывается только в лимите владельца.
- Папки имеют один уровень вложенности.
- При удалении папки проекты перемещаются в «Без папки».
- Участник видит название папки владельца, но внутри неё — только проекты, к которым ему выдан доступ.
- Только владелец управляет папками, участниками и ссылками-приглашениями.
- Роли: `owner`, `editor`, `viewer`.
- `editor` редактирует содержимое и запускает экспорт.
- `viewer` просматривает и экспортирует.
- Оба формата экспорта, PDF и PPTX, доступны участникам с доступом к проекту.
- Комментарии, real-time co-editing и история версий не входят в первую версию.
- Статистика: создано презентаций, создано слайдов, ориентировочно сэкономлено времени.
- Экономия рассчитывается только по готовым презентациям: `readyCount * 1.5` — нижняя граница и `readyCount * 2` — верхняя. В UI явно писать, что это приблизительная оценка.
- Загруженные материалы остаются внутри проекта; отдельной библиотеки материалов пока нет.

## Текущее состояние репозитория, которое важно учесть

- `apps/web/src/lib/internal-api.ts` всегда возвращает `TEMP_USER_ID || "local-user"`; реальной пользовательской сессии сейчас нет.
- В Prisma уже есть стандартные модели Auth.js: `User`, `Account`, `Session`, `VerificationToken`, а в зависимостях установлены `next-auth` и `@next-auth/prisma-adapter`.
- `apps/api/src/auth/internal-auth.guard.ts` доверяет `x-user-id` только вместе с `x-internal-token`; эту границу сервисов сохранить.
- Все project API сейчас проверяют только `Project.userId`. Перед добавлением sharing нужно централизовать проверки доступа.
- `ProjectsService.list()` сейчас возвращает полные `presentation`, `sources` и export, что слишком тяжело для кабинета. Нужен отдельный компактный summary DTO.
- Лимит сейчас списывается в `enqueueGeneration()`, а free-план имеет 3 презентации и только PDF. Требование кабинета — резервировать один из 10 слотов в момент создания или дублирования и разрешить PDF/PPTX.
- `NEXT_PUBLIC_DEMO_PREVIEW` сейчас подменяет `GET /projects` демонстрационным проектом. Это нельзя оставлять для авторизованного кабинета. Demo должен быть отдельным явным маршрутом/проектом, а не подменой списка пользователя.
- `/dashboard` сейчас является простым списком проектов. Его нужно превратить в обзор, а полный список перенести на `/projects`.

## Архитектурная схема

```text
Browser
  -> Next.js /login и Auth.js Telegram OIDC
  -> защищённые Next.js pages
  -> Next.js BFF routes /api/**
       -> INTERNAL_API_TOKEN + session.user.id
       -> NestJS /v1/**
            -> ProjectAccessService
            -> Prisma/PostgreSQL
            -> Redis/BullMQ
            -> MinIO
```

Браузер никогда не получает `INTERNAL_API_TOKEN` и не передаёт произвольный `x-user-id`. Идентификатор пользователя берётся только из проверенной server-side Auth.js-сессии.

## 1. Telegram-вход и сессия

### Выбранный подход

Использовать актуальный Telegram Login через OIDC и PKCE, отображая на `/login` одну понятную кнопку «Войти через Telegram». Официальный discovery endpoint: `https://oauth.telegram.org/.well-known/openid-configuration`.

Не реализовывать legacy iframe/widget HMAC-поток как основной. Текущая документация Telegram переводит Web Login на OIDC; legacy HMAC нужен только как отдельный явно согласованный fallback. Полезные первичные источники:

- <https://core.telegram.org/bots/telegram-login>
- <https://next-auth.js.org/configuration/providers/oauth>

### Переменные окружения

Добавить в `.env.example` и передать в `web`:

```dotenv
NEXTAUTH_URL=http://localhost:3020
NEXTAUTH_SECRET=change-me
TELEGRAM_CLIENT_ID=
TELEGRAM_CLIENT_SECRET=
```

Для production URL и redirect URI должны быть заранее зарегистрированы в BotFather → Bot Settings → Web Login. Не коммитить реальные секреты.

В `docker-compose.yml` передать `DATABASE_URL` в `web`, потому что PrismaAdapter Auth.js должен сохранять `User`, `Account` и `Session`. В контейнере использовать host `postgres`, а не `localhost`; добавить зависимость `web -> postgres` с health condition.

### Web-файлы

Создать:

- `apps/web/src/lib/prisma.ts` — singleton `PrismaClient` для Auth.js.
- `apps/web/src/lib/auth-options.ts` — `NextAuthOptions`, `PrismaAdapter`, кастомный Telegram OIDC provider, `checks: ["pkce", "state"]`, scopes `openid profile`, callbacks с `session.user.id`.
- `apps/web/src/app/api/auth/[...nextauth]/route.ts` — App Router handler `GET/POST`.
- `apps/web/src/types/next-auth.d.ts` — типизация `session.user.id`.
- `apps/web/src/middleware.ts` — защита `/dashboard`, `/projects/:path*`, `/new`, `/folders/:path*`, `/profile` и соответствующих BFF routes. Не защищать health, landing, login и Auth.js callback.
- `apps/web/src/app/login/page.tsx` — компактный экран входа.
- `apps/web/src/components/telegram-sign-in-button.tsx` — вызывает `signIn("telegram", { callbackUrl })` и показывает loading/error.
- `apps/web/src/components/session-provider.tsx` — `SessionProvider`, если он нужен client-компонентам header/profile.

Изменить:

- `apps/web/src/app/layout.tsx` — передать session provider, не показывать authenticated app navigation на `/login`.
- `apps/web/src/lib/internal-api.ts` — `requireUserId()` должен вызывать `getServerSession(authOptions)`. `TEMP_USER_ID/local-user` разрешить только при `ALLOW_DEV_AUTH=true`; без сессии возвращать/бросать 401, а не молча использовать общего пользователя.
- `apps/web/src/components/app-header.tsx` — аватар, имя и меню пользователя; пункты «Профиль», «Тариф», «Выйти».

### Telegram-профиль

В Auth.js callback/event после первого или повторного входа сохранять:

- `telegramId = String(profile.sub)`;
- `telegramUsername = profile.preferred_username ?? null`;
- `name = profile.name`;
- `image = profile.picture`.

Никогда не использовать username как идентификатор: он может отсутствовать и меняться. Канонический идентификатор — Telegram `sub`/`telegramId`.

## 2. Изменения Prisma

Изменить `prisma/schema.prisma` и создать новую миграцию, например `prisma/migrations/<timestamp>_personal_account_collaboration/migration.sql`.

### Новые enum

```prisma
enum ProjectMemberRole {
  editor
  viewer
}

enum FolderColor {
  orange
  green
  purple
  blue
  neutral
}
```

`owner` не хранить в `ProjectMember`: владельцем остаётся `Project.userId`. API вычисляет роль `owner` при совпадении `userId`.

### User

Добавить:

```prisma
telegramId       String?  @unique
telegramUsername String?
folders          Folder[]
projectMemberships ProjectMember[]
projectInvitesCreated ProjectInvitation[] @relation("InviteCreator")
```

Не делать email обязательным: Telegram-профиль может не содержать email.

### Folder

```prisma
model Folder {
  id        String      @id @default(cuid())
  ownerId   String
  name      String
  color     FolderColor @default(orange)
  sortOrder Int         @default(0)
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt
  owner     User        @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  projects  Project[]

  @@unique([ownerId, name])
  @@index([ownerId, sortOrder])
}
```

Ограничить имя на уровне shared schema: trim, 1–80 символов. Проверять принадлежность folder владельцу проекта в сервисе; одной FK недостаточно для этого бизнес-инварианта.

### Project

Добавить:

```prisma
folderId    String?
folder      Folder?             @relation(fields: [folderId], references: [id], onDelete: SetNull)
members     ProjectMember[]
invitations ProjectInvitation[]
```

Добавить индекс `@@index([folderId, updatedAt])`.

### ProjectMember

```prisma
model ProjectMember {
  id        String            @id @default(cuid())
  projectId String
  userId    String
  role      ProjectMemberRole
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  project   Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([projectId, userId])
  @@index([userId, updatedAt])
}
```

Сервис запрещает создавать membership владельцу проекта.

### ProjectInvitation

```prisma
model ProjectInvitation {
  id           String            @id @default(cuid())
  projectId    String
  tokenHash    String            @unique
  role         ProjectMemberRole
  createdById  String
  expiresAt    DateTime
  acceptedAt   DateTime?
  acceptedById String?
  revokedAt    DateTime?
  createdAt    DateTime          @default(now())
  project      Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdBy    User              @relation("InviteCreator", fields: [createdById], references: [id], onDelete: Cascade)

  @@index([projectId, createdAt])
}
```

Ссылки одноразовые, живут 7 дней. В БД хранить только `SHA-256` hash, сырой 32-byte random token показывать владельцу только в ответе создания.

Если Prisma потребует обратную relation для `acceptedById`, добавить именованную optional relation либо хранить `acceptedById` без relation. Не усложнять модель ради истории, если это мешает миграции.

### Presentation revision

Добавить в `Presentation`:

```prisma
revision Int @default(1)
```

Все изменения слайдов должны принимать `expectedRevision`. Обновлять через `updateMany where { projectId, revision: expectedRevision }` с `revision: { increment: 1 }`. Если `count === 0`, возвращать HTTP 409 и свежую ревизию. Это защита от потери изменений, не real-time collaboration.

### UsageCounter

Добавить поле:

```prisma
presentationsCreated Int @default(0)
```

Старое `generated` пока не удалять: оно отражает прежнюю семантику и может понадобиться для совместимости. Новую квоту считать только по `presentationsCreated`.

Миграцией безопасно заполнить `presentationsCreated` из количества `Project.createdAt`, сгруппированного по владельцу и месяцу в `Europe/Moscow`. Миграция должна быть идемпотентно применима один раз и не уничтожать существующие счётчики.

## 3. Shared contracts

Изменить `packages/shared/src/index.ts`. Все body/query/response shapes, используемые двумя приложениями, держать здесь в Zod, не дублировать интерфейсы в React и NestJS.

Добавить:

- `projectAccessRoleSchema = z.enum(["owner", "editor", "viewer"])`;
- `projectMemberRoleSchema = z.enum(["editor", "viewer"])`;
- `folderColorSchema`;
- `createFolderInputSchema`, `updateFolderInputSchema`;
- `updateProjectMetadataInputSchema` с `title?`, `folderId?: string | null`;
- `duplicateProjectInputSchema` с optional `title` и `folderId`;
- `createProjectInvitationInputSchema`;
- `updateProjectMemberInputSchema`;
- `projectListQuerySchema` (`scope`, `folderId`, `status`, `search`, `sort`, `cursor`, `limit`);
- `dashboardSummarySchema`;
- `usageSummarySchema`;
- `projectSummarySchema`;
- `folderSummarySchema`;
- `projectMemberSchema`;
- `updateSlideInputSchema` расширить обязательным `expectedRevision` для реальных проектов. Demo helper можно адаптировать отдельно.

Изменить `planLimits.free`:

```ts
monthlyPresentations: 10,
exports: ["pdf", "pptx"],
```

Не менять `maxSlides` и byte limits без отдельного продуктового решения. В wizard не предлагать пользователю число слайдов выше доступного ему лимита: получать capability/usage с API и фильтровать варианты.

### ProjectSummary DTO

Список не должен отдавать весь `Presentation.document`. Минимум:

```ts
{
  id,
  title,
  status,
  slideCount,
  updatedAt,
  createdAt,
  error,
  accessRole,
  owner: { id, name, image },
  folder: { id, name, color } | null,
  hasPresentation,
  latestExport: { id, type, status } | null,
  memberCount
}
```

## 4. Централизованные права доступа

Создать модуль, например:

- `apps/api/src/access/project-access.module.ts`
- `apps/api/src/access/project-access.service.ts`
- `apps/api/src/access/project-access.types.ts`

`ProjectAccessService.resolve(userId, projectId)` возвращает проект и вычисленную роль. Добавить helpers `requireViewer`, `requireEditor`, `requireOwner`.

Матрица:

| Действие | owner | editor | viewer |
|---|---:|---:|---:|
| Просмотр проекта/слайдов/asset/job | да | да | да |
| Экспорт PDF/PPTX и скачивание | да | да | да |
| Изменение слайда и текста выступления | да | да | нет |
| Загрузка материалов/изображений | да | да | нет |
| Запуск narration/generation | да | да | нет |
| Переименование, папка, дублирование, удаление | да | нет | нет |
| Приглашения и изменение ролей | да | нет | нет |

Если editor запускает генерацию, квота всё равно принадлежит `project.userId`, а не editor.

Заменить owner-only запросы во всех существующих местах:

- `apps/api/src/projects/projects.service.ts`
- `apps/api/src/exports/exports.service.ts`
- `apps/api/src/sources/sources.service.ts`
- `apps/api/src/jobs/jobs.controller.ts`
- slide asset upload/download
- export status/download URL

Пользователю без доступа возвращать 404, чтобы не раскрывать существование project ID. Для доступного проекта при недостаточной роли возвращать 403.

## 5. Квота 10 презентаций

Создать `apps/api/src/usage/usage.service.ts` и `usage.module.ts`.

Методы:

- `currentPeriod(now, "Europe/Moscow") -> YYYY-MM`;
- `nextResetAt(now) -> ISO timestamp первого числа следующего месяца`;
- `getSummary(userId)`;
- `reserveCreationSlot(tx, ownerId)`.

Резервирование должно быть атомарным в одной Prisma transaction с созданием/дублированием проекта:

1. Upsert `UsageCounter(userId, period)`.
2. Atomic `updateMany` с условием `presentationsCreated < planLimit` и increment на 1.
3. Если обновлено 0 строк — бросить `TooManyRequestsException`/HTTP 429 с машинным кодом `MONTHLY_PRESENTATION_LIMIT_REACHED`, `limit`, `used`, `resetsAt`.
4. Создать проект в той же transaction; при ошибке transaction откатит слот.

Удаление не возвращает слот. Генерация больше не увеличивает `presentationsCreated`. Удалить старое списание `usage.generated` из `enqueueGeneration()` после миграции тестов.

Дублирование расходует слот владельца нового проекта. В первой версии дублировать может только владелец исходника.

## 6. API

Все endpoint ниже остаются за `InternalAuthGuard` и вызываются через Next.js BFF.

### Dashboard и профиль

Создать `apps/api/src/dashboard/dashboard.module.ts`, controller/service:

- `GET /v1/dashboard` — user summary, usage, stats, recentProjects (5), activeProjects, sharedProjects (5).
- `GET /v1/users/me` — профиль Telegram и тариф.
- `DELETE /v1/users/me` — подтверждённое удаление аккаунта.

Статистика all-time:

- `presentationsCreated`: число проектов пользователя;
- `slidesCreated`: сумма `slideCount` готовых проектов пользователя;
- `readyPresentations`: число `status=ready`;
- `savedHoursMin = readyPresentations * 1.5`;
- `savedHoursMax = readyPresentations * 2`.

Совместные чужие проекты не прибавлять к личной статистике.

### Projects

Расширить `ProjectsController/ProjectsService`:

- `GET /v1/projects` — query filters, compact summaries, mine + memberships.
- `PATCH /v1/projects/:id` — owner-only rename/move.
- `POST /v1/projects/:id/duplicate` — owner-only deep duplicate.
- `DELETE /v1/projects/:id` — owner-only.

Scopes: `all`, `mine`, `shared`. Поиск — case-insensitive по title. Сортировки: `updated_desc` default, `created_desc`, `title_asc`. Для первой версии допустим cursor pagination limit 24; не загружать бесконечно весь JSON.

### Folders

Создать `apps/api/src/folders/*`:

- `GET /v1/folders` — папки владельца плюс virtual grouping для доступных shared folders; вернуть только counts доступных проектов.
- `POST /v1/folders` — создать.
- `PATCH /v1/folders/:id` — переименовать/color/sortOrder.
- `DELETE /v1/folders/:id` — transaction: `Project.updateMany(folderId -> null)`, затем удалить folder.

Только owner folder может mutate. Shared user видит metadata folder через доступные проекты, но не может менять folder.

### Collaboration

Создать `apps/api/src/collaboration/*`:

- `GET /v1/projects/:id/members` — owner/editor/viewer могут видеть участников; owner получает также активные invites.
- `POST /v1/projects/:id/invitations` — owner-only; body `{ role }`; response `{ inviteUrlToken, expiresAt }`.
- `DELETE /v1/projects/:id/invitations/:invitationId` — owner-only revoke.
- `GET /v1/invitations/:token/preview` — authenticated preview без раскрытия лишних данных.
- `POST /v1/invitations/:token/accept` — authenticated, atomic accept/upsert membership, single-use token.
- `PATCH /v1/projects/:id/members/:memberId` — owner-only role update.
- `DELETE /v1/projects/:id/members/:memberId` — owner-only revoke.
- `DELETE /v1/projects/:id/members/me` — участник покидает проект; owner не может покинуть свой проект.

После accept вернуть `projectId`, чтобы web сделал redirect в editor/read-only view.

### Error contract

Добавить единый сериализуемый shape для новых ошибок:

```json
{
  "code": "MONTHLY_PRESENTATION_LIMIT_REACHED",
  "message": "Лимит на этот месяц исчерпан",
  "details": { "limit": 10, "used": 10, "resetsAt": "..." }
}
```

Основные коды: `UNAUTHENTICATED`, `FORBIDDEN`, `PROJECT_NOT_FOUND`, `REVISION_CONFLICT`, `INVITATION_EXPIRED`, `INVITATION_USED`, `MONTHLY_PRESENTATION_LIMIT_REACHED`, `FOLDER_NAME_CONFLICT`.

## 7. Дублирование и удаление файлов

Нельзя просто скопировать JSON презентации: `Source.objectKey`, visual images и canvas image elements указывают на prefix исходного project ID.

Создать storage helper, например `apps/api/src/storage/project-storage.service.ts`:

- перечисляет объекты prefix `projects/{projectId}/`;
- копирует их в `projects/{newProjectId}/` через S3 `CopyObject`;
- строит map oldKey -> newKey;
- переписывает object keys в Source rows и `Presentation.document` (slide visual image, canvas image elements и другие реальные поля схемы);
- exports при дублировании не копирует;
- при частичной ошибке удаляет уже созданный destination prefix и не создаёт незавершённый дубль.

Удаление проекта и аккаунта должно удалять соответствующие MinIO prefixes до удаления DB rows. Если storage cleanup не удался, не подтверждать удаление как успешное. Логировать ошибку через существующий pino/Sentry, не включать секретные signed URLs.

Удаление аккаунта:

1. Собрать owned project IDs.
2. Удалить их storage prefixes.
3. Удалить `User`; Prisma cascade удалит owned projects/folders/memberships/sessions/accounts.
4. На web выполнить `signOut({ callbackUrl: "/" })`.

## 8. Next.js BFF

Сохранить текущую схему browser -> `/api/**` -> internal API. Создать общий helper `apps/web/src/lib/internal-api-route.ts`, который:

- получает session user;
- проксирует method/query/body;
- сохраняет upstream status 400/401/403/404/409/429 вместо превращения всего в 500;
- возвращает безопасный JSON error shape.

Добавить BFF routes для dashboard, profile, folders, project metadata/duplicate/delete, invitations/members. Существующие routes проектов, export, job, uploads и assets перевести на обновлённый helper.

`internalFetch()` больше не должен подменять `/projects` demo-данными. Явный demo можно оставить только для `/projects/demo` при development flag.

## 9. Web-интерфейсы

### App shell

На desktop использовать компактную левую навигацию или сохранить topbar, если переход на sidebar делает diff слишком широким. Приоритет — простота и единый app shell, а не декоративный редизайн.

Desktop navigation:

- Обзор → `/dashboard`
- Презентации → `/projects`
- Папки → `/folders`
- Создать → `/new`
- Тариф → `/pricing`
- Аватар → `/profile`

Mobile bottom navigation:

- Обзор
- Презентации
- Создать (визуально главное действие)
- Папки
- Профиль

Тариф на мобильном доступен из профиля.

Изменить `app-header.tsx`, `mobile-bottom-nav.tsx`, `layout.tsx`, `globals.css`. Использовать Lucide icons и существующие UI primitives. Не создавать сетку одинаковых декоративных карточек, не использовать glassmorphism, gradient text и чрезмерные радиусы.

### `/dashboard`

Создать server page + client widgets:

- заголовок с именем;
- primary CTA «Создать презентацию»;
- блок использования `N из 10`, progress и дата сброса;
- три компактных показателя: презентации, слайды, сэкономленное время;
- «Продолжить работу» — последний updated проект, если он не ready;
- «Последние презентации» — максимум 5;
- «Создаются сейчас»/ошибки — только если есть;
- shared section — только если есть.

Не показывать пустые секции. Loading — skeleton, не центральный spinner. Empty state объясняет первый следующий шаг.

### `/projects`

Создать:

- `apps/web/src/app/projects/page.tsx`;
- `apps/web/src/components/projects/projects-toolbar.tsx`;
- `project-list.tsx`/`project-row.tsx`;
- `project-actions-menu.tsx` на Radix DropdownMenu;
- `rename-project-dialog.tsx`, `move-project-dialog.tsx`, `delete-project-dialog.tsx`.

Функции:

- search с debounce;
- tabs/scope Все, Мои, Доступные мне;
- status и folder filters;
- sort;
- pagination/load more;
- действия с учётом `accessRole`;
- disabled Create/Duplicate при usage exhausted с объясняющим текстом и датой сброса.

Для простоты использовать list rows на desktop и компактные rows на mobile; не делать сложный переключатель grid/list в MVP.

### `/folders`

- список собственных папок и отдельная группа «Папки совместных проектов»;
- создать/переименовать/изменить цвет/удалить;
- клик ведёт на `/projects?folderId=...`;
- delete confirmation сообщает: «Презентации останутся и попадут в “Без папки”».

Не делать nested folders и drag-and-drop в первой версии. `sortOrder` можно менять кнопками/меню или оставить серверную сортировку по имени; drag-and-drop — non-goal.

### Sharing UI

Создать `share-project-dialog.tsx`:

- выбор role editor/viewer;
- создать одноразовую ссылку;
- copy button с подтверждением;
- срок действия;
- список участников;
- смена роли/revoke owner-only.

Создать `/invite/[token]/page.tsx`:

- если нет session — redirect на `/login?callbackUrl=/invite/...`;
- preview названия, владельца и роли;
- кнопка «Принять приглашение»;
- состояния expired/used/revoked;
- после accept redirect на project.

В editor для viewer все editing controls disabled/hidden, но export остаётся. Показать label «Только просмотр». Для editor показать обычный editor без owner-only project management.

### Profile и tariff

`/profile`:

- Telegram avatar, name, username;
- дата регистрации;
- текущий тариф и ссылка на `/pricing`;
- выход;
- danger section удаления аккаунта с повторным явным подтверждением.

`/pricing` и `/billing`:

- free plan: 10 презентаций/месяц, PDF/PPTX, папки, sharing;
- pricing информационный, без активного Stripe checkout;
- существующий Stripe backend не удалять, но CTA оплаты скрыть/заменить на «Скоро»;
- `/billing` можно превратить в usage details или redirect на `/pricing`.

### React Query

Расширить `apps/web/src/lib/project-queries.ts` либо разбить на:

- `dashboard-queries.ts`;
- `project-queries.ts`;
- `folder-queries.ts`;
- `collaboration-queries.ts`.

После mutations инвалидировать только релевантные keys: project lists, dashboard, folders, detail/members. Не использовать ручные повторяющиеся `fetch` state там, где уже есть TanStack Query.

## 10. Конфликты редактирования

В project detail response вернуть `presentationRevision`.

`PATCH /projects/:id/slides/:slideId` принимает `expectedRevision`. При 409 web:

1. Не перезаписывает серверные данные автоматически.
2. Показывает: «Презентация изменилась в другой вкладке или другим участником».
3. Предлагает «Загрузить свежую версию» и «Скопировать мой текст» для текстового поля, если это возможно.
4. Инвалидирует project query только после решения пользователя.

Это обязательная защита первой версии sharing. WebSocket/Yjs/CRDT не добавлять.

## 11. Точные изменения по существующим файлам

Минимальный ожидаемый diff:

### База/контракты

- `prisma/schema.prisma`
- `prisma/migrations/<new>/migration.sql`
- `packages/shared/src/index.ts`
- shared tests для новых schemas и plan limits

### API

- `apps/api/src/app.module.ts`
- `apps/api/src/projects/projects.controller.ts`
- `apps/api/src/projects/projects.service.ts`
- `apps/api/src/projects/projects.service.test.ts`
- `apps/api/src/exports/exports.service.ts`
- `apps/api/src/sources/sources.service.ts`
- `apps/api/src/jobs/jobs.controller.ts`
- новые modules: `access`, `usage`, `dashboard`, `folders`, `collaboration`, `users`, `storage`
- новые unit/integration tests для каждого критичного сервиса

### Web

- `apps/web/src/lib/internal-api.ts`
- `apps/web/src/lib/project-queries.ts` или разбитые query files
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/dashboard/page.tsx`
- новый `apps/web/src/app/projects/page.tsx`
- новые `/folders`, `/profile`, `/login`, `/invite/[token]`
- Auth.js route/options/prisma/type augmentation/middleware
- BFF route handlers для новых API
- `apps/web/src/components/app-header.tsx`
- `apps/web/src/components/mobile-bottom-nav.tsx`
- `apps/web/src/components/dashboard-project-list.tsx` заменить/разделить; не держать два конкурирующих списка
- `apps/web/src/components/new-project-form.tsx` — usage guard + школьный/вузовский уровень без hardcoded только university, если это ещё не исправлено другой веткой
- `apps/web/src/components/project-editor.tsx` — role/read-only/revision conflict
- `apps/web/src/components/export-panel.tsx` — viewer export разрешён
- `apps/web/src/app/globals.css`
- `apps/web/src/app/pricing/page.tsx`, `billing/page.tsx`

### Конфигурация

- `.env.example`
- `docker-compose.yml`
- при необходимости `Dockerfile.web`, только если Prisma client/schema недоступны в standalone image

## 12. Порядок реализации

### Этап A — фундамент auth и DB

1. Prisma migration + generate.
2. Shared contracts.
3. Telegram OIDC Auth.js + protected session.
4. `internalFetch` на session user и отключение implicit demo list.

Готово, когда два Telegram-аккаунта получают разные `User.id` и не видят проекты друг друга.

### Этап B — access, quota, summaries

1. `ProjectAccessService`.
2. Заменить owner-only проверки во всех API paths.
3. Atomic creation quota 10/month.
4. Compact project summaries + dashboard endpoint.
5. Revision conflict.

Готово, когда API tests доказывают role matrix и отсутствие quota race.

### Этап C — folders и project management

1. Folder CRUD.
2. Rename/move/delete.
3. Deep duplicate with S3 rewrite.
4. `/projects`, `/folders`, action menus.

### Этап D — collaboration

1. Invitation lifecycle.
2. Member management.
3. Invite page.
4. Read-only viewer editor + exports.

### Этап E — overview/profile/tariff polish

1. Dashboard composition and stats.
2. Profile/delete account.
3. Informational pricing.
4. Mobile/navigation/accessibility/empty/error/loading states.

## 13. Тесты

### API unit/integration (Vitest)

Обязательные cases:

- project owner/editor/viewer/outsider permissions for every action group;
- shared project appears once in list with correct `accessRole`;
- shared folder count does not reveal inaccessible projects;
- create #10 succeeds, create #11 returns 429;
- concurrent requests around slot #10 cannot both succeed;
- deleting project does not refund quota;
- duplicate consumes quota and rewrites S3 object keys;
- generation does not consume a second creation slot;
- editor-triggered generation consumes no editor quota;
- viewer can PDF/PPTX export but cannot edit;
- invite is hashed, expires, single-use and revocable;
- owner cannot be downgraded/removed through member endpoints;
- stale `expectedRevision` returns 409;
- folder delete sets project folderId null;
- dashboard saved time and totals only count owned ready projects.

### Web unit/component

- `requireUserId` rejects missing session when dev auth is off;
- status/error mapping preserves 409/429;
- project action menu hides forbidden actions by role;
- create CTA disabled at 10/10 with reset date;
- viewer editor is read-only while export controls remain;
- invitation states render correctly;
- Russian long labels fit mobile widths.

### Playwright

Расширить `e2e/studydeck-core.spec.ts` или добавить отдельный spec с mocked/dev auth fixtures:

1. Login redirect for protected page.
2. Dashboard overview renders usage and recent project.
3. Create folder → move project → filter by folder.
4. Rename/duplicate/delete flow.
5. Owner creates invite; second user accepts; project appears under shared.
6. Viewer cannot edit and can request both exports.
7. 10/10 blocks create and duplicate.
8. Mobile bottom nav has five agreed destinations and no clipped labels.

Network calls to Telegram, AI, Tavily and Stripe должны быть mocked/env-gated в тестах.

## 14. Проверка и запуск

После shared changes сначала собрать package:

```powershell
npm run build -w @studydeck/shared
npm run prisma:generate
npm run typecheck -w @studydeck/shared
npm run typecheck -w @studydeck/api
npm run test -w @studydeck/api
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
npm run test:e2e
docker compose config --quiet
```

Для обычной frontend-проверки использовать `npm run dev:web:fast` и `http://localhost:3020`. После Prisma/API изменений держать Docker postgres/redis/minio и API запущенными. Если пользователь отдельно попросит production-container validation на `localhost:3010`, rebuild затронет как минимум `web api`, а из-за shared/API contract также проверить `worker`; не делать долгий web Docker build вместо fast preview без такого запроса.

Проверить вручную desktop и mobile:

- `/login`
- `/dashboard`
- `/projects`
- `/folders`
- `/profile`
- `/pricing`
- `/invite/<token>`
- editor как owner/editor/viewer

После typecheck убрать случайный diff `apps/web/tsconfig.tsbuildinfo`, если он не является намеренным.

## 15. Acceptance criteria

- Без Telegram-сессии защищённые страницы недоступны.
- Разные пользователи изолированы; общий `local-user` невозможен при выключенном dev auth.
- Dashboard открывается первым и показывает реальные компактные данные, usage и три статистики.
- Free user может создать максимум 10 проектов за календарный месяц; одиннадцатый блокируется и API, и UI.
- PDF и PPTX доступны владельцу и любому участнику с viewer/editor доступом.
- Папки работают без вложенности; удаление папки не удаляет проекты.
- Shared user видит folder label, но не видит чужие недоступные проекты в той же папке.
- Owner может выдать/изменить/отозвать доступ ссылкой; editor/viewer не могут управлять доступом.
- Viewer не может изменить проект; editor может. Stale save не перетирает чужую работу.
- Rename, move, deep duplicate и delete работают без битых MinIO ссылок.
- Списки не передают полный presentation JSON для каждой строки.
- Все новые тексты на русском, без mojibake, с keyboard focus, AA contrast и корректной mobile layout.
- Существующие generation, editor, source upload, worker jobs и PDF/PPTX export не регрессировали.

## 16. Non-goals

- Real-time курсоры и совместное редактирование через WebSocket/Yjs/CRDT.
- Комментарии и упоминания.
- История версий и восстановление.
- Вложенные папки и drag-and-drop сортировка.
- Общая библиотека PDF/DOCX между проектами.
- Платная подписка и активный Stripe checkout.
- Email/password, Google, VK или Mini App auth.
- Telegram-уведомления от бота.
- Редизайн generated slide themes, canvas engine или export templates.

## 17. Важные запреты для реализации

- Не доверять `userId` из browser body/query/header.
- Не хранить raw invitation tokens.
- Не проверять роль только в UI; API является источником прав.
- Не использовать username Telegram как primary identity.
- Не списывать квоту дважды на create и generation.
- Не копировать presentation JSON без S3 key rewrite.
- Не возвращать полный deck JSON в dashboard/project list.
- Не ослаблять существующие generation/export quality gates ради кабинета.
- Не изменять legacy `server.js` и root HTML, если это не требуется отдельно.
