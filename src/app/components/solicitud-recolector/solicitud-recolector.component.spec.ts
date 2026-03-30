import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SolicitudRecolectorComponent } from './solicitud-recolector.component';

describe('SolicitudRecolectorComponent', () => {
  let component: SolicitudRecolectorComponent;
  let fixture: ComponentFixture<SolicitudRecolectorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SolicitudRecolectorComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(SolicitudRecolectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
