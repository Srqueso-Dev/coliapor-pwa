import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { RegisterComponent } from './components/register/register.component';
import { OnboardingComponent } from './components/onboarding/onboarding.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { PerfilComponent } from './components/perfil/perfil.component';
import { ConfiguracionComponent } from './components/configuracion/configuracion.component';
import { AdminComponent } from './components/admin/admin.component';
import { CalendarioComponent } from './components/calendario/calendario.component';
import { PagosComponent } from './components/pagos/pagos.component';
import { ChatComponent } from './components/chat/chat.component';

export const routes: Routes = [
  { path: '',              redirectTo: 'login', pathMatch: 'full' },
  { path: 'login',         component: LoginComponent },
  { path: 'register',      component: RegisterComponent },
  { path: 'onboarding',    component: OnboardingComponent },
  { path: 'dashboard',     component: DashboardComponent },
  { path: 'perfil',        component: PerfilComponent },
  { path: 'configuracion', component: ConfiguracionComponent },
  { path: 'admin',         component: AdminComponent },
  { path: 'calendario',    component: CalendarioComponent },
  { path: 'pagos',         component: PagosComponent },
  { path: 'chat',          component: ChatComponent }
];