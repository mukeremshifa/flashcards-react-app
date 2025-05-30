import Row from '../ui/Row';
import styled from 'styled-components';
import { Link } from 'react-router-dom';

const Container = styled.div`
  max-width: 40vw;
  min-height: 60vh;
  margin: 0 auto;
  display: flex;
  justify-content: center;
  flex-direction: column;
  gap: 3.2rem;
`;

const HomeText = styled.p`
  font-size: 4rem;
  font-weight: 600;
  text-align: center;
`;

const StyledLink = styled(Link)`
  color: var(--color-brand-600);
`;

const ButtonRow = styled.div`
  display: flex;
  justify-content: center;
  gap: 2rem;
  font-weight: 500;
  font-size: 1.8rem;
`;

function Dashboard() {
  return (
    <Container>
      <Row type="horizontal">
        <HomeText>
          Your Goto Flashcards App. Making Study Sessions Easy and Fun.
        </HomeText>
      </Row>

      <ButtonRow>
        <StyledLink to="/fromtext">Create from text</StyledLink>
        <span>or</span>
        <StyledLink to="/fromtext">Upload a Document</StyledLink>
      </ButtonRow>
    </Container>
  );
}

export default Dashboard;
