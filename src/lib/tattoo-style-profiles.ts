export type TattooStyleProfile = {
  id: string
  name: string
  focus: string
  line: string
  fill: string
  mix: string
  colors: readonly [string, string, string]
}

export const TATTOO_STYLE_PROFILES: readonly TattooStyleProfile[] = [
  { id: 'fine-line', colors: ['#242126','#60565a','#826c72'], name: 'Fine-line', focus: 'тонкая линия и аккуратные интервалы', line: 'Минимальный стабильный штрих', fill: 'Редкая, контролируемая заливка', mix: 'Сдержанная смесь без потери просветов' },
  { id: 'lettering', colors: ['#242126','#6d5860','#a57986'],  name: 'Lettering', focus: 'читаемость букв и ритм просветов', line: 'Ровный контур и одинаковый ритм', fill: 'Чёткие внутренние просветы', mix: 'Смесь только для акцентов' },
  { id: 'blackwork', colors: ['#17151a','#3d3540','#665563'],  name: 'Blackwork', focus: 'плотные массы и контраст', line: 'Сильный силуэт', fill: 'Цельные тёмные массы', mix: 'Глубокий однородный пигмент' },
  { id: 'traditional-neo', colors: ['#251d22','#9b3e47','#d49b62'],  name: 'Traditional / neo', focus: 'контур, масса и цветовой акцент', line: 'Выраженный контур', fill: 'Ясные плоскости цвета', mix: 'Насыщенный акцент внутри контура' },
  { id: 'japanese', colors: ['#211c25','#6a3242','#b6755f'],  name: 'Японская крупная композиция', focus: 'крупный ритм и читаемость на расстоянии', line: 'Иерархия главного контура', fill: 'Крупные связанные поля', mix: 'Ограниченный цветовой фокус' },
  { id: 'dotwork-ornament', colors: ['#29232b','#6d596d','#ad8a9c'],  name: 'Dotwork / орнамент', focus: 'ритм точек и повторяемость', line: 'Равномерный шаг', fill: 'Постепенная плотность', mix: 'Точечные цветовые переходы' },
  { id: 'illustrative-color', colors: ['#26202a','#6a4d78','#bb7180'],  name: 'Иллюстративный цвет', focus: 'слои, контраст и цветовая модель', line: 'Линия поддерживает форму', fill: 'Разделённые цветовые плоскости', mix: 'Свободная смесь в пределах формы' },
] as const
