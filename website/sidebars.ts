import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Getting Started',
      items: ['quickstart'],
      collapsed: false,
    },
    {
      type: 'category',
      label: 'Concepts',
      items: ['architecture'],
      collapsed: false,
    },
    {
      type: 'category',
      label: 'Guides',
      items: ['providers', 'auth', 'commands'],
      collapsed: false,
    },
    {
      type: 'category',
      label: 'Reference',
      items: ['manifest-reference'],
      collapsed: false,
    },
  ],
};

export default sidebars;
