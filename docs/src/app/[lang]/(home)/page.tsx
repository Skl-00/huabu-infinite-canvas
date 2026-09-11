import Link from 'next/link';
import { ArrowUpRight, BookOpen, Check, Code2, Rocket } from 'lucide-react';
import { appNames, gitConfig } from '@/lib/shared';
import { localizePath, type Locale } from '@/lib/i18n';
import type { Metadata } from 'next';

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

const messages = {
  en: {
    eyebrow: 'Open-source visual workflow workspace',
    center: 'Build ideas into connected work',
    description:
      'HuaBu Canvas is a browser-first workspace for arranging prompts, references, assets, and generated results on a persistent canvas.',
    quickStart: 'Quick Start',
    source: 'View source',
    capabilities: 'What is in the workspace',
    capabilityDescriptions: [
      'Organize projects, nodes, connections, and viewport state in the browser.',
      'Run image, text, video, and audio workflows through your configured providers.',
      'Keep prompts, references, generated results, and reusable assets connected.',
      'Connect a local Canvas Agent when you want Codex to inspect or operate the canvas.',
    ],
    foundation: 'Built on an open canvas foundation',
    foundationDescription:
      'HuaBu Canvas continues the open-source infinite-canvas foundation with a product layer focused on creative workflows, durable local projects, and practical iteration.',
    status: 'Current product boundary',
    statusDescription:
      'The application is actively evolving. Cloud accounts, hosted storage, billing, and private capabilities are intentionally not presented as built-in features.',
  },
  'zh-CN': {
    eyebrow: '开源视觉工作流工作台',
    center: '把想法组织成可继续的创作',
    description:
      'HuaBu 画布是一个浏览器优先的创作工作台，把提示词、参考素材、资产和生成结果放进一张可持续迭代的画布。',
    quickStart: '快速开始',
    source: '查看源码',
    capabilities: '工作台当前包含',
    capabilityDescriptions: [
      '在浏览器中组织项目、节点、连线和视口状态。',
      '通过你配置的渠道执行图片、文本、视频和音频工作流。',
      '让提示词、参考素材、生成结果和可复用资产保持关联。',
      '需要时连接本地 Canvas Agent，让 Codex 读取或操作当前画布。',
    ],
    foundation: '基于开放画布底座继续开发',
    foundationDescription:
      'HuaBu 画布基于开源 infinite-canvas 底座继续构建，产品层聚焦创作工作流、本地项目留存和可追溯迭代。',
    status: '当前产品边界',
    statusDescription:
      '项目仍在持续开发。云端账号、托管存储、计费和卡藏私有能力并未被包装成内置功能。',
  },
};

export default async function HomePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  const locale = lang as Locale;
  const text = messages[locale];
  const appName = appNames[locale];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-16 pt-8 md:px-10 md:pt-14">
      <section className="grid min-h-[520px] items-center gap-10 border-b border-zinc-200 pb-12 dark:border-zinc-800 lg:grid-cols-[0.88fr_1.12fr]">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <Rocket className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            {text.eyebrow}
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-zinc-950 dark:text-zinc-50 md:text-6xl [font-family:var(--font-display)]">
            {appName}
            <span className="block text-zinc-500 dark:text-zinc-400">{text.center}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-600 dark:text-zinc-400">
            {text.description}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={localizePath(locale, '/docs/overview/quick-start')}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              <BookOpen className="size-4" />
              {text.quickStart}
            </Link>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-900 transition hover:border-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
            >
              <Code2 className="size-4" />
              {text.source}
              <ArrowUpRight className="size-4" />
            </a>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950 p-6 shadow-2xl dark:border-zinc-800">
          <div className="flex items-center justify-between border-b border-white/10 pb-4 text-xs text-zinc-400">
            <span>HuaBu Canvas</span>
            <span>Local-first workspace</span>
          </div>
          <div className="mt-6 grid min-h-[280px] grid-cols-3 gap-3">
            <div className="col-span-2 rounded-lg border border-emerald-300/30 bg-emerald-300/10 p-4">
              <div className="text-xs text-emerald-200">Prompt / reference / result</div>
              <div className="mt-16 h-2 w-3/4 rounded bg-white/20" />
              <div className="mt-3 h-2 w-1/2 rounded bg-white/10" />
            </div>
            <div className="rounded-lg border border-sky-300/20 bg-sky-300/10 p-4">
              <div className="text-xs text-sky-100">Assets</div>
              <div className="mt-8 grid grid-cols-2 gap-2">
                <div className="aspect-square rounded bg-white/15" />
                <div className="aspect-square rounded bg-white/10" />
                <div className="aspect-square rounded bg-white/10" />
                <div className="aspect-square rounded bg-white/15" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-14">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50 md:text-3xl">
            {text.capabilities}
          </h2>
          <Link
            href={localizePath(locale, '/docs/overview/features')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-800 transition hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white"
          >
            {text.quickStart}
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <div className="mt-6 grid gap-x-8 gap-y-5 md:grid-cols-2">
          {text.capabilityDescriptions.map((description) => (
            <div
              key={description}
              className="flex gap-3 border-t border-zinc-200 pt-4 text-sm leading-7 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
            >
              <Check className="mt-1 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{description}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16 grid gap-8 border-t border-zinc-200 pt-10 dark:border-zinc-800 md:grid-cols-2">
        <div>
          <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{text.foundation}</h2>
          <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-400">{text.foundationDescription}</p>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{text.status}</h2>
          <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-400">{text.statusDescription}</p>
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            <Code2 className="size-4" />
            {text.source}
            <ArrowUpRight className="size-4" />
          </a>
        </div>
      </section>
    </main>
  );
}

export async function generateMetadata({ params }: PageProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  const locale = lang as Locale;
  const text = messages[locale];

  return {
    title: `${appNames[locale]} | ${text.center}`,
    description: text.description,
    alternates: {
      languages: {
        en: '/',
        'zh-CN': '/zh-CN',
      },
    },
  };
}
