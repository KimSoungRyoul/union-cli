import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'union-cli',
  tagline: 'YAML 선언 한 장으로 팀 전용 통합 CLI를 만드는 프레임워크',
  favicon: 'img/favicon.ico',

  url: 'https://kimsoungryoul.github.io',
  baseUrl: '/union-cli/',

  organizationName: 'KimSoungRyoul',
  projectName: 'union-cli',

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'ko',
    locales: ['ko'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          path: './docs',
          routeBasePath: '/',
          editUrl:
            'https://github.com/KimSoungRyoul/union-cli/edit/main/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'union-cli',
      logo: {
        alt: 'union-cli Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/KimSoungRyoul/union-cli',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Quickstart',
              to: '/',
            },
            {
              label: 'Architecture',
              to: '/architecture',
            },
            {
              label: 'Manifest Reference',
              to: '/manifest-reference',
            },
          ],
        },
        {
          title: 'Guides',
          items: [
            {
              label: 'Providers',
              to: '/providers',
            },
            {
              label: 'Auth',
              to: '/auth',
            },
            {
              label: 'Commands',
              to: '/commands',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/KimSoungRyoul/union-cli',
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} union-cli. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['yaml', 'typescript', 'javascript', 'python', 'bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
