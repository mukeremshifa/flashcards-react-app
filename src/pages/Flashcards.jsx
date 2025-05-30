import styled from 'styled-components';

import Heading from '../ui/Heading';
import Row from '../ui/Row';
import Cards from '../ui/CardSet';

const Container = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(2, 1fr);
  grid-column-gap: 18px;
  grid-row-gap: 12px;
`;

function Flashcards() {
  return (
    <>
      <Row type="horizontal">
        <Heading as="h1">All Flashcards</Heading>
        <p>TEST</p>
      </Row>

      <Container>
        <Cards />
        <Cards />
        <Cards />
        <Cards />
        <Cards />
        <Cards />
      </Container>
    </>
  );
}

export default Flashcards;
