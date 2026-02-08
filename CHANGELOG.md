# 🚀 Quick Explorer v0.1.9
*Changelog - 8 de Febrero, 2026*

## 🛡️ Estabilidad y Rendimiento (Foco de la Versión)

### 🧩 Aislamiento Total de COM (Fix de Crushes)
- **STA Worker Pool**: Implementación de un pool de hilos de "Apartamento Único" (STA) dedicado para operaciones de Windows Shell.
- **Eliminación de Violación de Acceso**: Solucionado definitivamente el error `STATUS_ACCESS_VIOLATION` al arrastrar archivos mediante la aislación total de los entornos COM.
- **Navegación Asíncrona**: El listado de archivos y la papelera ahora operan en hilos aislados, evitando bloqueos en la interfaz.

### ⚡ Optimización de Miniaturas y Previsualización
- **Carga de Miniaturas bajo demanda**: Las dimensiones de los archivos ahora se obtienen solo cuando son necesarias, acelerando drásticamente el renderizado de carpetas grandes.
- **Adiós al Parpadeo**: Los procesos de FFmpeg para videos ahora se ejecutan de forma invisible, eliminando el parpadeo de ventanas de terminal.
- **Vista Previa Instantánea**: Las imágenes de previsualización aparecen al instante desde el cache sin esperar al procesamiento de metadatos.

## 🚀 Quick Explorer v0.1.8
*Changelog - 7 de Febrero, 2026*

## ✨ Nuevas Funcionalidades

### 📝 Mejoras en Renombrado
- **Seleccion Inteligente**: Al renombrar, se selecciona automáticamente el nombre del archivo sin la extensión.
- **Enfoque Automático**: El campo de texto recibe el foco al instante en ambas vistas.

## 🐛 Correcciones de Errores

- **Sincronización de Arrastre**: Mejorado el timing de inicio del arrastre para evitar conflictos.
- **Corrección de Solapamiento**: Solucionado el problema donde las pestañas se encimaban al redimensionar.
- **Nombres "Pegajosos"**: El campo de renombrado se cierra correctamente al navegar.

# 🚀 Quick Explorer v0.1.7
*Changelog - 30 de Enero, 2026*

## ✨ Nuevas Funcionalidades

### 🔄 Reordenamiento de Pestañas (Drag & Drop)
- **Arrastrar y Soltar**: Ahora puedes reorganizar tus pestañas arrastrándolas horizontalmente.
- **Animaciones Fluidas**: Las pestañas se desplazan suavemente para hacer espacio mientras arrastras.
- **Feedback Visual**: La pestaña arrastrada se eleva con una sombra premium para indicar el estado activo.

### 📜 Auto-Scroll Inteligente de Pestañas
- **Visibilidad Garantizada**: Al navegar con `Ctrl+Tab` o al abrir nuevas pestañas, la barra se desplaza automáticamente para mostrar la pestaña activa.
- **Respeto al Segundo Plano**: Si tienes activada la opción de "abrir pestañas en segundo plano", la barra NO se desplazará al crear nuevas pestañas.
- **Barra Invisible**: El scroll funciona sin mostrar barras de desplazamiento visibles.

### ⌨️ Selección con Shift+Home/End
- **`Shift + Inicio`**: Selecciona todos los archivos desde el actual hasta el primero de la lista.
- **`Shift + Fin`**: Selecciona todos los archivos desde el actual hasta el último de la lista.
- Funciona tanto en vista de Lista como en vista de Cuadrícula.

## ⌨️ Mejoras en Atajos de Teclado

### Atajos Globales (funcionan siempre, incluso mientras escribes)
- `Ctrl+T` → Nueva pestaña
- `Ctrl+W` → Cerrar pestaña
- `Ctrl+Tab` / `Ctrl+Shift+Tab` → Navegar entre pestañas
- `F5` → Refrescar directorio
- `Ctrl+L` → Enfocar barra de direcciones
- `Escape` → Limpiar búsqueda y selección

## 🐛 Correcciones de Errores

- **Cierre con Clic Central**: Restaurado el cierre de pestañas con el botón central del mouse.
- **Estabilidad de Arrastre**: Eliminado el desplazamiento vertical accidental al arrastrar pestañas.
- **Doble Clic Preciso**: El doble clic para maximizar/restaurar ahora solo responde al botón izquierdo.
- **Protección de Pestaña Única**: Si solo hay una pestaña, no se permite arrastrarla (evita glitches visuales).
- **Colores Consistentes**: Las pestañas mantienen su color original durante el arrastre.

---
*Quick Explorer Project © 2026 - Versión 0.1.9*
