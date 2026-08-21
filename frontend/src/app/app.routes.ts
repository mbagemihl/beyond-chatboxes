import { Routes } from '@angular/router';

// Demo paths and their 1–4 shortcut order live in demo-registry.ts; keep this
// list in the same order.
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./home/home').then((m) => m.Home),
    title: 'Beyond the Chatbox',
  },
  {
    path: 'pose',
    loadComponent: () => import('./demos/pose/pose').then((m) => m.Pose),
    title: 'Pose — Beyond the Chatbox',
  },
  {
    path: 'search',
    loadComponent: () => import('./demos/search/search').then((m) => m.Search),
    title: 'Semantic Search — Beyond the Chatbox',
  },
  {
    path: 'smartform',
    loadComponent: () => import('./demos/smartform/smartform').then((m) => m.Smartform),
    title: 'Smart Form — Beyond the Chatbox',
  },
  {
    path: 'benchmark',
    loadComponent: () => import('./benchmark/benchmark').then((m) => m.Benchmark),
    title: 'Local vs Cloud — Beyond the Chatbox',
  },
  // A mistyped URL on stage must land somewhere sensible, never a blank page.
  { path: '**', redirectTo: '' },
];
