# Changelog

## [0.1.6] - 2026-01-29

### ✨ Nuevas Funcionalidades
- **Diseño Responsivo Proporcional**: Los paneles ahora guardan su tamaño como una proporción de la ventana, manteniendo el layout consistente al maximizar o redimensionar.
- **Ancho Fijo del Sidebar**: Se ha fijado el panel izquierdo en **220px** y se ha eliminado su capacidad de redimensionamiento para mayor estabilidad.
- **Límites de Ventana Nativos**: Implementado un ancho mínimo nativo de **1370px** para evitar que la interfaz se deforme en pantallas pequeñas.

### ⚙️ Mejoras y Correcciones
- **Restricciones de Seguridad**: El panel central ahora tiene un mínimo garantizado de **800px** y el panel de información un mínimo de **350px**.
- **Limpieza de Código**: Eliminación de imports y variables no utilizadas en el backend (Rust) y frontend (React).
- **Estabilidad Estructural**: Reparación de errores en `App.tsx` y `tauri.conf.json` que afectaban la consistencia del redimensionamiento.
- **Intercepción de Menú Contextual**: Mejora en la captura de eventos para evitar menús del sistema en zonas de arrastre.
