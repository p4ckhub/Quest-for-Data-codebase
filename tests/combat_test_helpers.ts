function generateSpellbookWithSaveObject(saveObject: SaveObject, outputDir: string): void {
  // Use the imported spellbook module's function
  const savePath = path.join(outputDir, 'save.json');
  const saveData = {
    spells: [
      {
        lesson_id: 'test-lesson',
        name: 'test_spell',
        signature: 'int test_spell()',
        source_code: `int test_spell() { return 1; }`
      }
    ]
  };
  
  // Write temp save file for the module to read
  fs.writeFileSync(savePath, JSON.stringify(saveData, null, 2));
  
  console.log('[DEBUG] Calling generateSpellbook with outputDir:', outputDir);
  console.log('[DEBUG] Save path:', savePath);
  
  (generateSpellbook as any)(saveData, outputDir);
  
  console.log('[DEBUG]spellbook.h contents after generation:');
  if (fs.existsSync(path.join(outputDir, 'spellbook.h'))) {
    console.log(fs.readFileSync(path.join(outputDir, 'spellbook.h'), 'utf-8'));
  } else {
    console.log('[DEBUG]spellbook.h was not created');
  }
}

function generateSpellbookWithSaveObjectInvalid(saveObject: SaveObject, outputDir: string): void {
  // Same as above but for testing rollback
  const savePath = path.join(outputDir, 'save.json');
  fs.writeFileSync(savePath, JSON.stringify(saveObject, null, 2));
  
  (generateSpellbook as any)(saveObject, outputDir);
}
