# ClawDEX (React + Vite)

## 本地运行

```bash
npm i
npm run dev
```

## 一键推送到 GitHub（触发 Vercel 自动部署）

```bash
npm run deploy "更新说明"
```

## Redis 环境变量（Vercel）

- **`REDIS_URL`**：Redis 连接串（Vercel Redis 绑定项目后会提供/自动填充）

## 后台管理系统（/admin）

后台用于管理各页面内容与模块开关/排序，配置存 Redis。

Vercel 环境变量新增：

- **`ADMIN_PASSWORD`**：后台登录密码
- **`ADMIN_SECRET`**：会话签名密钥（随机字符串，建议至少 32 位）

修改本地 `.env` **不会**自动同步到线上：若你访问的是已部署站点（或 App 内嵌了 `VITE_API_BASE` 指向线上），必须在 **Vercel → 项目 → Settings → Environment Variables** 里更新上述变量并 **Redeploy**，否则仍会提示「密码错误」。

访问：

- **`/admin`**

接口：

- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET/PUT /api/admin/config?page=home|market|newTokens|bot|swap`
- `GET /api/public-config?page=...`（前台读取）

---

下面是 Vite 模板原始说明（可忽略）。

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
