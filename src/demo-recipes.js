/**
 * Made-up demo recipes for the UI. Fictional names and amounts only;
 * nothing here comes from a real person or a real cookbook.
 * @module demo-recipes
 */

/** @typedef {{ id: string, title: string, servings: number, text: string }} DemoRecipe */

/** @type {DemoRecipe[]} */
export const DEMO_RECIPES = [
  {
    id: 'moonbeam-pancakes',
    title: 'Moonbeam Pancakes (made-up demo)',
    servings: 4,
    text: [
      '1 1/2 cups flour',
      '2 tbsp sugar',
      '2 tsp baking powder',
      '½ tsp salt',
      '1 1/4 cups milk',
      '2 eggs',
      '3 tbsp melted butter',
      '1 pinch of stardust sprinkles',
      '',
      'Maple syrup to taste',
    ].join('\n'),
  },
  {
    id: 'dragon-chili',
    title: 'Gentle Dragon Chili (made-up demo)',
    servings: 6,
    text: [
      '500 g ground beans',
      '2 onions, diced',
      '3 cloves garlic',
      '800 ml crushed tomatoes',
      '1.5 tbsp chili powder',
      '1-2 tsp cumin',
      '250 ml vegetable broth',
      '',
      'Salt to taste',
      'Grated cheese, for topping',
    ].join('\n'),
  },
];

/**
 * Find a demo recipe by id.
 * @param {string} id
 * @returns {DemoRecipe | undefined}
 */
export function findDemo(id) {
  return DEMO_RECIPES.find((r) => r.id === id);
}
