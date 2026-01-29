# 🚀 SpeedExplorer v0.1.1
*Changelog - 29 de Enero, 2026*

## ✨ Nuevas Funcionalidades
- **Mover a Pestaña (Native Move)**: Ahora puedes mover archivos y carpetas directamente a cualquier pestaña abierta.
    - Utiliza la API nativa de Windows (Win32) para mayor velocidad y confiabilidad.
    - **Sin usar el portapapeles**: Tus textos e imágenes copiados permanecen intactos.
- **Gestión Inteligente de Pestañas**: Si una carpeta que tienes abierta en una pestaña es eliminada o movida, la pestaña se cerrará automáticamente para evitar errores de navegación.

## 🖥️ Interfaz y Experiencia de Usuario (UI/UX)
- **Ergonomía del Menú Contextual**: Reubicamos la opción "Mover a" junto a Copiar, Cortar y Pegar para una navegación más fluida.
- **Experiencia Nativa Purificada**: Desactivamos el menú contextual por defecto del navegador (Inspeccionar) para que la aplicación se sienta como un programa nativo de Windows.
- **Feedback Visual de Portapapeles**: Los archivos copiados o cortados ahora aparecen atenuados (dimmed) en la lista, indicando claramente su estado.
- **Mejoras en Pestañas**: Optimización del área de clic en las pestañas al estar la ventana maximizada.

## ⚙️ Estabilidad y Correcciones
- **Soporte Multi-selección**: Corregimos un error crítico que impedía que las acciones del menú contextual (Eliminar, Copiar, Mover) funcionaran correctamente cuando había varios elementos seleccionados.
- **Prevención de Colisión de Columnas**: Ajustamos el diseño de la tabla de archivos para evitar que las columnas se desplacen fuera de la vista al redimensionar los paneles laterales.
- **Normalización de Rutas**: Mejoramos la comparación de carpetas para evitar errores al intentar mover una carpeta dentro de sí misma.

---
*SpeedExplorer Project © 2026 - Versión 0.1.1*
