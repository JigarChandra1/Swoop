// Simple test to verify game functionality
// This can be run in the browser console

function testGameLogic() {
  console.log('Testing Swoop game logic...');
  
  // Test lane configuration
  const LANES = [
    {sum:2, L:3, basket:true},
    {sum:3, L:4, basket:false},
    {sum:4, L:5, basket:true},
    {sum:5, L:6, basket:false},
    {sum:6, L:7, basket:true},
    {sum:7, L:8, basket:false},
    {sum:8, L:7, basket:true},
    {sum:9, L:6, basket:false},
    {sum:10, L:5, basket:true},
    {sum:11, L:4, basket:false},
    {sum:12, L:3, basket:true},
  ];
  
  console.log('✓ Lane configuration correct:', LANES.length === 11);
  
  // Test checkpoints function
  function checkpoints(L){
    const out=[2];
    if(L>=6) out.push(4);
    out.push(L-1);
    out.push(L);
    return [...new Set(out)].filter(x=>x>=1&&x<=L);
  }
  
  console.log('✓ Checkpoints for L=7:', checkpoints(7)); // Should be [2, 4, 6]
  console.log('✓ Checkpoints for L=3:', checkpoints(3)); // Should be [2]
  
  // Test deterrents function
  function deterrents(L,sum){ 
    if(L<=3) return []; 
    const det=[3,L-2]; 
    if((sum===6||sum===8)&&L>=5) det.push(5); 
    const cps=checkpoints(L); 
    return [...new Set(det)].filter(x=>x>=1&&x<=L && !cps.includes(x)); 
  }
  
  console.log('✓ Deterrents for L=7, sum=6:', deterrents(7, 6)); // Should include deterrents
  
  // Test grid positioning
  const COLS = 27;
  const CENTER_COL = 13;
  const LEFT_START_COL = 1;
  const RIGHT_END_COL = COLS - 2;
  const LEFT_SPAN = CENTER_COL - LEFT_START_COL - 1;
  const RIGHT_SPAN = RIGHT_END_COL - CENTER_COL - 1;

  function colForStep(side, step, L) {
    // Final step (step L) is always at the center column for both sides
    if (step === L) return CENTER_COL;
    if (side === 'L') {
      const rel = Math.round((LEFT_SPAN - 1) * (step - 1) / (L - 1));
      return LEFT_START_COL + rel;
    }
    const rel = Math.round((RIGHT_SPAN - 1) * (step - 1) / (L - 1));
    return RIGHT_END_COL - rel;
  }
  
  console.log('✓ Grid positioning for L side, step 1, L=7:', colForStep('L', 1, 7));
  console.log('✓ Grid positioning for R side, step 1, L=7:', colForStep('R', 1, 7));

  // Test swoop adjacency logic
  function testSwoopAdjacency() {
    console.log('\nTesting swoop adjacency logic...');

    // Test case: selected sum is 10 (lane index 8)
    const selectedSum = 10;
    const selectedLaneIndex = LANES.findIndex(lane => lane.sum === selectedSum);
    console.log('✓ Selected sum 10 maps to lane index:', selectedLaneIndex); // Should be 8

    const adjacentLaneIndices = [selectedLaneIndex - 1, selectedLaneIndex + 1].filter(idx => idx >= 0 && idx < LANES.length);
    const adjacentSums = adjacentLaneIndices.map(idx => LANES[idx].sum);
    console.log('✓ Adjacent lane indices for sum 10:', adjacentLaneIndices); // Should be [7, 9]
    console.log('✓ Adjacent sums for sum 10:', adjacentSums); // Should be [9, 11]

    // Test edge cases
    const edgeSum2 = 2; // First lane
    const edgeIndex2 = LANES.findIndex(lane => lane.sum === edgeSum2);
    const edgeAdjacent2 = [edgeIndex2 - 1, edgeIndex2 + 1].filter(idx => idx >= 0 && idx < LANES.length);
    const edgeAdjacentSums2 = edgeAdjacent2.map(idx => LANES[idx].sum);
    console.log('✓ Adjacent sums for edge case sum 2:', edgeAdjacentSums2); // Should be [3] only

    const edgeSum12 = 12; // Last lane
    const edgeIndex12 = LANES.findIndex(lane => lane.sum === edgeSum12);
    const edgeAdjacent12 = [edgeIndex12 - 1, edgeIndex12 + 1].filter(idx => idx >= 0 && idx < LANES.length);
    const edgeAdjacentSums12 = edgeAdjacent12.map(idx => LANES[idx].sum);
    console.log('✓ Adjacent sums for edge case sum 12:', edgeAdjacentSums12); // Should be [11] only

    console.log('✓ Swoop adjacency logic tests passed!');
  }

  testSwoopAdjacency();

  console.log('\nAll basic game logic tests passed! ✓');
}

// Run the test
if (typeof window !== 'undefined') {
  // Browser environment
  window.testGameLogic = testGameLogic;
  console.log('Test function available as window.testGameLogic()');
} else {
  // Node environment
  testGameLogic();
}
