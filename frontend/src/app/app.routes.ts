import { Routes } from '@angular/router';

export const routes: Routes = [
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
  { path: '', redirectTo: 'pose', pathMatch: 'full' },
];
